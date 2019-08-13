```javascript
var targetHandlers = {
	'plugin static dirs': function (parallel, callback) {
		meta.js.linkStatics(callback);
        // 在build/public/plugins下建立软链接，指向plugins的源目录
        // 默认情况下，Plugins.staticDirs 是空的
        // 所以这个函数其实什么都没有干
	},
	'requirejs modules': function (parallel, callback) {
		meta.js.buildModules(parallel, callback);
        // modules主要就是modules\ clients \ admin
        // D:\workspace\NodeBB\build\public\src\ modules、client、admin 这三个目录先删除
        // 开发模式下：linkModules 
            modules: {
        		'Chart.js': 'node_modules/chart.js/dist/Chart.min.js',  // html5图标 www.chartjs.org
        		'mousetrap.js': 'node_modules/mousetrap/mousetrap.min.js',  // 就是一个监听键盘事件的组件 https://craig.is/killing/mice
        		'cropper.js': 'node_modules/cropperjs/dist/cropper.min.js',
        		'jqueryui.js': 'public/vendor/jquery/js/jquery-ui.js',
        		'zxcvbn.js': 'node_modules/zxcvbn/dist/zxcvbn.js',
        		ace: 'node_modules/ace-builds/src-min',
        		'clipboard.js': 'node_modules/clipboard/dist/clipboard.min.js',
        	}
        // public/src 下面的三大模块 + 上面的modules中的7个模块，获取这些所有模块下的文件
        // 获取到所有文件后，然后minifyModules把他们解析、压缩、输出到各自destPath目录。解析压缩用的事UglifyJS
        // 最终就是再public/src 下面多了 admin
	},
	'client js bundle': function (parallel, callback) {
		meta.js.buildBundle('client', parallel, callback);
	},
	'admin js bundle': function (parallel, callback) {
		meta.js.buildBundle('admin', parallel, callback);
	},
	javascript: [
		'plugin static dirs',
		'requirejs modules',
		'client js bundle',
		'admin js bundle',
	],
	'client side styles': function (parallel, callback) {
		meta.css.buildBundle('client', parallel, callback);
	},
	'admin control panel styles': function (parallel, callback) {
		meta.css.buildBundle('admin', parallel, callback);
	},
	styles: [
		'client side styles',
		'admin control panel styles',
	],
	templates: function (parallel, callback) {
		meta.templates.compile(callback);
	},
	languages: function (parallel, callback) {
		meta.languages.build(callback);
	},
	sounds: function (parallel, callback) {
		meta.sounds.build(callback);
	},
};

```
