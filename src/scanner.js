/**
 * Created by Eugene A. Molchanov
 * Date: 12.06.15
 * github.com/emolchanov
 */

var nodeModulesDir = "node_modules";

var fs = require("fs");
var cp = require("child_process");
var async = require("async");
var rimraf = require("rimraf");
var svn = require("svn-interface");
var colors = require('colors/safe');

var cacheFile = __dirname + "/../.cache";
var rootDir = __dirname + "/../../..";
var pkg = require(rootDir + "/package.json");
var pkgDeps = pkg.svnDependencies || {};
var svnOptions = pkg.svnOptions || {};
var deps = {};
var dep = "";
var errors = [];
var numDeps;
var CACHEBUFFER = [];

Object.keys(pkgDeps).forEach(function (dep) {
    deps[dep] = buildDepObj(dep, pkgDeps);
});

numDeps = Object.keys(deps).length;

async.each(deps, function (dep, cb) {
    async.series([
        validateCache(dep),
        mkdirs(dep),
        checkout(dep),
        cleanup(dep),
        update(dep),
        cleanup(dep),
        writeToCache(dep),
        npmInstall(dep)
    ], info(dep, cb));
}, function () {
    writeBufferToCache();
});

function buildDepObj(str, deps) {
    console.log('buildDepObj - start');
    var out = {};
    out.repo = deps[str];
    if (str.indexOf("@") > 0 && str.indexOf("|") == -1) {
        str = /^(.*)@(.*)$/.exec(str);
        out.name = str[1];
        out.tag = str[2];
        out.rev = "HEAD";
        if (out.tag.toLowerCase() != "trunk") out.repo = out.repo + "/tags/";
    } else if (str.indexOf("@") > 0 && str.indexOf("|") > 0) {
        str = /^(.*)@(.*)\|(.*)$/.exec(str);
        out.name = str[1];
        out.tag = str[2];
        out.rev = str[3];
        if (out.tag.toLowerCase() != "trunk") out.repo = out.repo + "/tags/";
    } else if (out.repo.indexOf("/trunk/") > 0) {
        out.name = str;
        out.tag = "";
        out.rev = "HEAD";
    } else {
        out.name = str;
        out.tag = "";
        out.rev = "HEAD";
    }
    out.COPath = out.repo + "/" + out.tag;
    out.installDir = nodeModulesDir + "/" + out.name + "/";
    out.installDirExists = fs.existsSync(rootDir + '/' + out.installDir);
    console.log('buildDepObj - end');
    return out;
}

function writeToCache(dep) {
    return function (callback) {
        console.log('writeToCache - start');
        CACHEBUFFER.push(dep);
        callback(null);
        console.log('writeToCache - end');
    }
}

function writeBufferToCache() {
    console.log('writeBufferToCache - start');
    var data = readCache();
    CACHEBUFFER.forEach(function (dep) {
        data[dep.name] = dep;
    });
    return writeCache(data)(function () {
        console.log('writeBufferToCache - end');
    });
}

function writeCache(data) {
    return function (callback) {
        console.log('writeCache - start');
        fs.writeFile(cacheFile, JSON.stringify(data), function (error, result) {
            callback(error);
        });
        console.log('writeCache - end');
    }
}

function readCache() {
    console.log('readCache - start');
    console.log('readCache - end');
    return fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
}

function validateCache(dep) {
    return function (callback) {
        console.log('validateCache - start');
        var data = readCache();
        var depCache = data[dep.name];
        if (depCache) {
            dep.latest = (depCache.tag === dep.tag && depCache.rev === dep.rev) ? true : false;
        }
        console.log('validateCache - end');
        return callback(null);
    }
}

function mkdirs(dep) {
    return function (callback) {
        console.log('mkdirs - start');
        if (dep.latest) {
            console.log('mkdirs - end');
            callback(null);
        }
        else async.waterfall([
                function (cb) {
                    fs.exists(rootDir + "/" + nodeModulesDir, function (exists) {
                        console.log('mkdirs - end');
                        cb(null, exists);
                    });
                },
                function (exists, cb) {
                    if (!exists)
                        fs.mkdir(rootDir + "/" + nodeModulesDir, function (error) {
                            console.log('mkdirs - end');
                            cb(error);
                        });
                    else {
                        cb(null);
                    }
                },
                function (cb) {
                    fs.exists(rootDir + "/" + dep.installDir, function (exists) {
                        console.log('mkdirs - end');
                        cb(null, exists);
                    });
                },
                function (exists, cb) {
                    if (exists)
                        rimraf(rootDir + "/" + dep.installDir, function (error) {
                            console.log('mkdirs - end');
                            cb(error);
                        });
                    else {
                        cb(null);
                    }
                }
            ],
            function (error) {
                console.log('validateCache - end (error)');
                callback(error);
            }
        );
    };
}

function checkout(dep) {
    return function (callback) {
        console.log('checkout - start');
        if (dep.latest && dep.installDirExists) {
            console.log('checkout - end');
            callback(null);
        }
        else {
            console.log(colors.green("Checking"), colors.yellow(dep.name), "rev=" + dep.rev, "from", dep.COPath);
            svn.checkout(dep.COPath, rootDir + "/" + dep.installDir,
                Object.assign({ revision: dep.rev }, svnOptions),
                function (error, result) {
                    console.log('checkout - end');
                    return callback(error ? result : null)
                })
        }
    }
}

function update(dep) {
    return function (callback) {
        console.log('update - start');
        if (dep.installDirExists && !dep.skipUpdate) {
            console.log(colors.green("Updating"), colors.yellow(dep.name), "rev=" + dep.rev, "from", dep.COPath);
            return svn.update([rootDir + "/" + dep.installDir],
                Object.assign({ revision: dep.rev }, svnOptions),
                function (error, result) {
                    //console.log("UP", result);
                    console.log('update - end');
                    return callback(error ? result : null)
                });
        }
    }
}

function cleanup(dep) {
    return function (callback) {
        console.log('cleanup - start');
        if (dep.installDirExists) return svn.cleanup([rootDir + "/" + dep.installDir], svnOptions, function (error, result) {
            //console.log("Cleanup", result);
            console.log('cleanup - end');
            return callback(error ? result : null)
        })
    }
}

function npmInstall(dep) {
    return function (callback) {
        console.log('npmInstall - start');
        var eKeys = Object.keys(process.env),
            env   = {}, i;
        //console.log("Running `npm install` on " + dep.name + "...");

        for (i = eKeys.length; i--;) {
            if (!/^npm_/i.test(eKeys[i])) {
                env[eKeys[i]] = process.env[eKeys[i]];
            }
        }

        if (dep.installDirExists) cp.exec("npm install --production", {
            stdio: "inherit",
            cwd  : rootDir + "/" + dep.installDir,
            env  : env
        }, function (error) {
            callback(error ? "npm install failed" : null);
        });
        console.log('npmInstall - end');
    };
}

function info(dep, cb) {
    console.log('info - start');
    return function (error) {
        if (error) {
            console.log(colors.red("Failed to install " + dep.name));
            errors.push(dep.name + " (" + error + ")");
        }

        if (!error) console.log(colors.green("\nInstalled ") + colors.yellow(dep.name) + "@" + dep.tag + "|" + dep.rev, dep.installDir);

        if (0 === --numDeps) {
            if (errors.length) {
                console.log(colors.red("\nEncountered errors installing svn dependencies:"));
                errors.forEach(function (err) {
                    console.log(colors.red(" * " + err));
                });
                console.log("\n");
            } else {
                console.log(colors.green("\nFinished installing svn dependencies"));
            }
        }
        cb();
        console.log('info - end');
    };
}
