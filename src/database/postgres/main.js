'use strict';

module.exports = function (db, module) {
	var helpers = require('./helpers');

	var query = db.query.bind(db);

	module.flushdb = async function () {
		await query(`DROP SCHEMA "public" CASCADE`);
		await query(`CREATE SCHEMA "public"`);
};

	module.emptydb = async function () {
		await query(`DELETE FROM "legacy_object"`);
	};

	module.exists = async function (key) {
		if (!key) {
			return;
		}

		if (Array.isArray(key)) {
			const res = await query({
				name: 'existsArray',
				text: `
				SELECT o."_key" k
  				FROM "legacy_object_live" o
 				WHERE o."_key" = ANY($1::TEXT[])`,
				values: [key],
			});
			return key.map(function (k) {
				return res.rows.some(r => r.k === k);
			});
		}
		const res =	await query({
			name: 'exists',
			text: `
			SELECT EXISTS(SELECT *
					FROM "legacy_object_live"
				   WHERE "_key" = $1::TEXT
				   LIMIT 1) e`,
			values: [key],
		});
		return res.rows[0].e;
	};

	module.delete = async function (key) {
		if (!key) {
			return;
		}

		await query({
			name: 'delete',
			text: `
DELETE FROM "legacy_object"
 WHERE "_key" = $1::TEXT`,
			values: [key],
		});
	};

	module.deleteAll = async function (keys) {
		if (!Array.isArray(keys) || !keys.length) {
			return;
		}

		await query({
			name: 'deleteAll',
			text: `
DELETE FROM "legacy_object"
 WHERE "_key" = ANY($1::TEXT[])`,
			values: [keys],
		});
	};

	module.get = async function (key) {
		if (!key) {
			return;
		}

		const res = await query({
			name: 'get',
			text: `
SELECT s."data" t
  FROM "legacy_object_live" o
 INNER JOIN "legacy_string" s
         ON o."_key" = s."_key"
        AND o."type" = s."type"
 WHERE o."_key" = $1::TEXT
 LIMIT 1`,
			values: [key],
		});

		return res.rows.length ? res.rows[0].t : null;
	};

	module.set = async function (key, value) {
		if (!key) {
			return;
		}

		await module.transaction(async function (client) {
			var query = client.query.bind(client);
			await helpers.ensureLegacyObjectType(client, key, 'string');
			await query({
				name: 'set',
				text: `
INSERT INTO "legacy_string" ("_key", "data")
VALUES ($1::TEXT, $2::TEXT)
ON CONFLICT ("_key")
DO UPDATE SET "data" = $2::TEXT`,
				values: [key, value],
			});
		});
	};

	module.increment = async function (key) {
		if (!key) {
			return;
		}

		return await module.transaction(async function (client) {
			var query = client.query.bind(client);
			await helpers.ensureLegacyObjectType(client, key, 'string');
			const res = await query({
				name: 'increment',
				text: `
INSERT INTO "legacy_string" ("_key", "data")
VALUES ($1::TEXT, '1')
ON CONFLICT ("_key")
DO UPDATE SET "data" = ("legacy_string"."data"::NUMERIC + 1)::TEXT
RETURNING "data" d`,
				values: [key],
			});
			return parseFloat(res.rows[0].d);
		});
	};

	module.rename = async function (oldKey, newKey) {
		await module.transaction(async function (client) {
			var query = client.query.bind(client);
			await query({
				name: 'deleteRename',
				text: `
	DELETE FROM "legacy_object"
	 WHERE "_key" = $1::TEXT`,
				values: [newKey],
			});
			await query({
				name: 'rename',
				text: `
UPDATE "legacy_object"
SET "_key" = $2::TEXT
WHERE "_key" = $1::TEXT`,
				values: [oldKey, newKey],
			});
		});
	};

	module.type = async function (key) {
		const res = await query({
			name: 'type',
			text: `
SELECT "type"::TEXT t
  FROM "legacy_object_live"
 WHERE "_key" = $1::TEXT
 LIMIT 1`,
			values: [key],
		});

		return res.rows.length ? res.rows[0].t : null;
	};

	async function doExpire(key, date) {
		await query({
			name: 'expire',
			text: `
UPDATE "legacy_object"
   SET "expireAt" = $2::TIMESTAMPTZ
 WHERE "_key" = $1::TEXT`,
			values: [key, date],
		});
	}

	module.expire = async function (key, seconds) {
		await doExpire(key, new Date(((Date.now() / 1000) + seconds) * 1000));
	};

	module.expireAt = async function (key, timestamp) {
		await doExpire(key, new Date(timestamp * 1000));
	};

	module.pexpire = async function (key, ms) {
		await doExpire(key, new Date(Date.now() + parseInt(ms, 10)));
	};

	module.pexpireAt = async function (key, timestamp) {
		await doExpire(key, new Date(timestamp));
	};
};
