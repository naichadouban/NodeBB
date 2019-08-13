## meta.js.linkStatics

会把插件plugins放到 `build/public/plugins` 下面。

不过nodebb/build的时候，Plugins.staticDirs 是空。

所以这个函数其实什么都没有干.

这个函数就是创建一些软链接（plugins源目录链接到目标目录 `build/public/plugins`

## js.

