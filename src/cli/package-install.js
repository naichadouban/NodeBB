'use strict';

var path = require('path');
var fs = require('fs');
var cproc = require('child_process');

var packageFilePath = path.join(__dirname, '../../package.json');
var packageDefaultFilePath = path.join(__dirname, '../../install/package.json');
var modulesPath = path.join(__dirname, '../../node_modules');
// 把install目录下的package.json的内容追加到根目录下的package.json
// 应为初始状态根目录的package.json是空的，所以第一次调用的话就相当于是文件的复制了
function updatePackageFile() {
	var oldPackageContents = {};

	try {
		oldPackageContents = JSON.parse(fs.readFileSync(packageFilePath, 'utf8'));
	} catch (e) {
		if (e.code !== 'ENOENT') {
			throw e;
		}
	}

	var defaultPackageContents = JSON.parse(fs.readFileSync(packageDefaultFilePath, 'utf8'));
	var packageContents = Object.assign({}, oldPackageContents, defaultPackageContents, {
		dependencies: Object.assign({}, oldPackageContents.dependencies, defaultPackageContents.dependencies),
	});

	fs.writeFileSync(packageFilePath, JSON.stringify(packageContents, null, 2));
}

exports.updatePackageFile = updatePackageFile;

function installAll() {
	var prod = global.env !== 'development';
	var command = 'npm install';
	try {
		fs.accessSync(path.join(modulesPath, 'nconf/package.json'), fs.constants.R_OK);
		var packageManager = require('nconf').get('package_manager');
		if (packageManager === 'yarn') {
			command = 'yarn';
		}
	} catch (e) {
		// ignore
	}
	try {
		// 但该方法在子进程完全关闭之前不会返回
		cproc.execSync(command + (prod ? ' --production' : ''), {
			cwd: path.join(__dirname, '../../'),  // cwd 子进程当前的工作工作目录
			stdio: [0, 1, 2], //stdio 子进程的 stdio 配置。默认情况下，除非指定了 stdio，否则 stderr 将会被输出到父进程的 stderr
		});
	} catch (e) {
		console.log('Error installing dependencies!');
		console.log('message: ' + e.message);
		console.log('stdout: ' + e.stdout);
		console.log('stderr: ' + e.stderr);
		throw e;
	}
}

exports.installAll = installAll;

function preserveExtraneousPlugins() {
	// Skip if `node_modules/` is not found or inaccessible
	try {
		fs.accessSync(modulesPath, fs.constants.R_OK);
	} catch (e) {
		return;  // 根目录下没有node_mudules目录的话，直接返回
	}

	var isPackage = /^nodebb-(plugin|theme|widget|reward)-\w+/;
	var packages = fs.readdirSync(modulesPath).filter(function (pkgName) {
		return isPackage.test(pkgName);
	});
	var packageContents = JSON.parse(fs.readFileSync(packageFilePath, 'utf8'));

	var extraneous = packages
		// only extraneous plugins (ones not in package.json) which are not links
		.filter(function (pkgName) {
			const extraneous = !packageContents.dependencies.hasOwnProperty(pkgName);
			const isLink = fs.lstatSync(path.join(modulesPath, pkgName)).isSymbolicLink();

			return extraneous && !isLink;
		})
		// reduce to a map of package names to package versions
		.reduce(function (map, pkgName) {
			var pkgConfig = JSON.parse(fs.readFileSync(path.join(modulesPath, pkgName, 'package.json'), 'utf8'));
			map[pkgName] = pkgConfig.version;
			return map;
		}, {});

	// Add those packages to package.json
	Object.assign(packageContents.dependencies, extraneous);
	fs.writeFileSync(packageFilePath, JSON.stringify(packageContents, null, 2));
}

exports.preserveExtraneousPlugins = preserveExtraneousPlugins;
