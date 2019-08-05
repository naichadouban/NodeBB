'use strict';

var winston = require('winston');
var express = require('express');
var bodyParser = require('body-parser');
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var less = require('less');
var async = require('async');
var uglify = require('uglify-es');
var nconf = require('nconf');
var Benchpress = require('benchpressjs');  // 就是很小的js 模版引擎

var app = express();
var server;

var formats = [
	winston.format.colorize(),
];
// 自定义格式
const timestampFormat = winston.format((info) => {
	var dateString = new Date().toISOString() + ' [' + global.process.pid + ']';
	info.level = dateString + ' - ' + info.level;
	return info;
});
formats.push(timestampFormat());
formats.push(winston.format.splat());
formats.push(winston.format.simple());

winston.configure({
	level: 'verbose',
	format: winston.format.combine.apply(null, formats), // 那这个日志对象，就会把上面我们定义的几种格式都包含进去
	transports: [
		new winston.transports.Console({
			handleExceptions: true,
		}),
		new winston.transports.File({
			filename: 'logs/webinstall.log',
			handleExceptions: true,
		}),
	],
});

var web = module.exports;  // web现在就是module.exports指向的内存区域

var scripts = [
	'node_modules/jquery/dist/jquery.js',
	'public/vendor/xregexp/xregexp.js', //JavaScript Regex
	'public/vendor/xregexp/unicode/unicode-base.js',
	'public/src/utils.js',
	'public/src/installer/install.js',
	'node_modules/zxcvbn/dist/zxcvbn.js', //密码复杂度相关，各种语言（golang）都有相应的包
];

var installing = false;
var success = false;
var error = false;
var launchUrl;

web.install = function (port) {
	port = port || 4567;
	winston.info('Launching web installer on port ' + port);
	// express.static 相当于express的一个中间件，提供静态文件的
	app.use(express.static('public', {}));
	app.engine('tpl', function (filepath, options, callback) { // 这相当于自定义express的扩展引擎
		async.waterfall([
			function (next) {
				fs.readFile(filepath, 'utf-8', next);
			},
			function (buffer, next) {
				Benchpress.compileParse(buffer.toString(), options, next);
			},
		], callback);
	});
	// 在express可以呈现模版前，必须设置以下应用程序
	// 1。views：模板文件所在目录。例如：app.set('views', './views')
	// 2。view engine：要使用的模板引擎。例如：app.set('view engine', 'pug')
	app.set('view engine', 'tpl');
	app.set('views', path.join(__dirname, '../src/views'));
	app.use(bodyParser.urlencoded({ // 解析 application/x-www-form-urlencoded
		// extended - 当设置为false时，会使用querystring库解析URL编码的数据；
		// 当设置为true时，会使用qs库解析URL编码的数据。后没有指定编码时，使用此编码。默认为true
		extended: true,
	}));

	async.parallel([compileLess, compileJS, copyCSS, loadDefaults], function (err) {
		if (err) {
			winston.error(err);
		}
		setupRoutes();
		launchExpress(port);
	});
};


function launchExpress(port) {
	server = app.listen(port, function () {
		winston.info('Web installer listening on http://%s:%s', '0.0.0.0', port);
	});
}

function setupRoutes() {
	app.get('/', welcome);
	app.post('/', install);
	app.post('/launch', launch);
	app.get('/ping', ping);
	app.get('/sping', ping);
}

function ping(req, res) {
	res.status(200).send(req.path === '/sping' ? 'healthy' : '200');
}

function welcome(req, res) {
	var dbs = ['redis', 'mongo', 'postgres'];
	var databases = dbs.map(function (databaseName) {
		var questions = require('../src/database/' + databaseName).questions.filter(function (question) {
			return question && !question.hideOnWebInstall;
		});

		return {
			name: databaseName,
			questions: questions,
		};
	});

	var defaults = require('./data/defaults');

	res.render('install/index', {
		url: nconf.get('url') || (req.protocol + '://' + req.get('host')),
		launchUrl: launchUrl,
		skipGeneralSetup: !!nconf.get('url'),
		databases: databases,
		skipDatabaseSetup: !!nconf.get('database'),
		error: error,
		success: success,
		values: req.body,
		minimumPasswordLength: defaults.minimumPasswordLength,
		minimumPasswordStrength: defaults.minimumPasswordStrength,
		installing: installing,
	});
}

function install(req, res) {
	if (installing) {
		return welcome(req, res);
	}
	req.setTimeout(0);
	installing = true;
	var setupEnvVars = nconf.get();
	for (var i in req.body) {
		// hasOwnProperty() 	决定某个对象是否有某个属性？
		// install请求中，setupEnvVars没有的属性给添加上
		if (req.body.hasOwnProperty(i) && !process.env.hasOwnProperty(i)) {
			setupEnvVars[i.replace(':', '__')] = req.body[i];
		}
	}

	// Flatten any objects in setupEnvVars
	const pushToRoot = function (parentKey, key) {
		setupEnvVars[parentKey + '__' + key] = setupEnvVars[parentKey][key];
	};
	for (var j in setupEnvVars) {
		if (setupEnvVars.hasOwnProperty(j) && typeof setupEnvVars[j] === 'object' && setupEnvVars[j] !== null && !Array.isArray(setupEnvVars[j])) {
			Object.keys(setupEnvVars[j]).forEach(pushToRoot.bind(null, j));
			delete setupEnvVars[j];
		} else if (Array.isArray(setupEnvVars[j])) {
			setupEnvVars[j] = JSON.stringify(setupEnvVars[j]);
		}
	}

	winston.info('Starting setup process');
	winston.info(setupEnvVars);
	launchUrl = setupEnvVars.url;

	var child = require('child_process').fork('app', ['--setup'], {
		env: setupEnvVars,
	});

	child.on('close', function (data) {
		installing = false;
		success = data === 0;
		error = data !== 0;

		welcome(req, res);
	});
}

function launch(req, res) {
	res.json({});
	server.close();

	var child;

	if (!nconf.get('launchCmd')) {
		child = childProcess.spawn('node', ['loader.js'], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'],
		});

		console.log('\nStarting NodeBB');
		console.log('    "./nodebb stop" to stop the NodeBB server');
		console.log('    "./nodebb log" to view server output');
		console.log('    "./nodebb restart" to restart NodeBB');
	} else {
		// Use launchCmd instead, if specified
		child = childProcess.exec(nconf.get('launchCmd'), {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'],
		});
	}

	var filesToDelete = [
		'installer.css',
		'installer.min.js',
		'bootstrap.min.css',
	];

	async.each(filesToDelete, function (filename, next) {
		fs.unlink(path.join(__dirname, '../public', filename), next);
	}, function (err) {
		if (err) {
			winston.warn('Unable to remove installer files');
		}

		child.unref();
		process.exit(0);
	});
}
// 把public/less/install.less编译成public/installer.css
function compileLess(callback) {
	fs.readFile(path.join(__dirname, '../public/less/install.less'), function (err, style) {
		if (err) {
			return winston.error('Unable to read LESS install file: ', err);
		}

		less.render(style.toString(), function (err, css) {
			if (err) {
				return winston.error('Unable to compile LESS: ', err);
			}

			fs.writeFile(path.join(__dirname, '../public/installer.css'), css.css, callback);
		});
	});
}
// 把几个js文件编译成一个
function compileJS(callback) {
	var code = '';
	async.eachSeries(scripts, function (srcPath, next) {
		fs.readFile(path.join(__dirname, '..', srcPath), function (err, buffer) {
			if (err) {
				return next(err);
			}

			code += buffer.toString();
			next();
		});
	}, function (err) {
		if (err) {
			return callback(err);
		}
		try {
			// UglifyJS is a JavaScript parser, minifier, compressor and beautifier toolkit.
			var minified = uglify.minify(code, {
				compress: false,
			});
			if (!minified.code) {
				return callback(new Error('[[error:failed-to-minify]]'));
			}
			fs.writeFile(path.join(__dirname, '../public/installer.min.js'), minified.code, callback);
		} catch (e) {
			callback(e);
		}
	});
}
// 把node_modules下的bootstrap样式文件，拷贝到public目录下
function copyCSS(next) {
	async.waterfall([
		function (next) {
			fs.readFile(path.join(__dirname, '../node_modules/bootstrap/dist/css/bootstrap.min.css'), 'utf8', next);
		},
		function (src, next) {
			fs.writeFile(path.join(__dirname, '../public/bootstrap.min.css'), src, next);
		},
	], next);
}

function loadDefaults(next) {
	var setupDefaultsPath = path.join(__dirname, '../setup.json');
	fs.access(setupDefaultsPath, fs.constants.F_OK | fs.constants.R_OK, function (err) {
		if (err) {
			// setup.json not found or inaccessible, proceed with no defaults
			return setImmediate(next);
		}

		winston.info('[installer] Found setup.json, populating default values');
		nconf.file({
			file: setupDefaultsPath,
		});

		next();
	});
}
