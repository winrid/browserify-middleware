const uglify = require('uglify-es');
const watchify = require('watchify');
const buildBundle = require('./build-bundle');

/*
    This worker is STATEFUL and is a SINGLETON.
    Each instance of browserify-middleware gets a pool of bundle-worker. A bundle-worke can be responsible for more than one bundle to reduce context switching/max open file issues.
    On init the bundle is defined and then methods like getSource and notifyOnUpdate retrieve state from this singleton.
 */

var bundlesByPath = {};

function minify(str, options) {
    if (!options || typeof options !== 'object') options = {};
    const result = uglify.minify(str, options);
    if (result.error) {
        throw result.error;
    }
    return result;
}

// TODO seeing init for same path multiple times. Need to Optimize.
function init(options, callback) {
    console.log('INIT FOR PATH', options.path);

    if (!options.path) {
        throw new Error('Invalid Path: ' + options.path);
    }

    try {
        if (options.settingsModulePath) { // instead of using "settings", use the raw option object as there are many issues w/ the settings module.
            require(options.settingsModulePath)(options);
        }
        else {
            throw new Error('No settings module path defined!');
        }

        bundlesByPath[options.path] = buildBundle(options.path, options);
        callback();
    }
    catch(e) {
        console.error('browserify-middleware bundle-worker init error', e);
        throw e;
    }
}

function ensureBundleExists(options) {
    if (bundlesByPath[options.path] === undefined) {
        init(options, function() {});
    }
}

module.exports = {
    start: function (noop, cb) {
        cb()
    },
    init: function(rawOptions, callback) {
        init(JSON.parse(rawOptions), callback);
    },
    getSource: function getSource(rawOptions, callback) {
        const options = JSON.parse(rawOptions);

        ensureBundleExists(options);

        return new Promise(function (resolve, reject) {
            bundlesByPath[options.path].bundle(function (err, src) {
                if (err) return reject(err);
                resolve(src);
            });
        }).then(function (src) {
            src = src.toString();
            return options.postcompile ? options.postcompile(src) : src;
        }).then(function (src) {
            return (options.minify && options.preminify) ? options.preminify(src) : src;
        }).then(function (src) {
            if (options.minify) {
                try {
                    src = minify(src, options.minify).code;
                } catch (ex) {
                } //better to just let the client fail to parse
            }
            return (options.minify && options.postminify) ? options.postminify(src) : src;
        }).then(function success(src) {
            callback(null, src);
        }, function failure(err) {
            console.error('browserify-middleware bundle-worker getSource failure', err);
            callback(err, null);
        });
    },
    notifyOnUpdate: function notifyOnUpdate(rawOptions, callback) {
        const options = JSON.parse(rawOptions);
        ensureBundleExists(options);

        bundlesByPath[options.path] = watchify(bundlesByPath[options.path], {poll: true, delay: 0});
        bundlesByPath[options.path].on('update', function () {
            callback();
        });
    },
    closeBundle: function (path, callback) {
        bundlesByPath[path].close();
        callback();
    }
};

