const uglify = require('uglify-es');
const watchify = require('watchify');
const buildBundle = require('./build-bundle');

const {
    parentPort, workerData
} = require('worker_threads');

let bundle = null; // this worker is responsible for one path - meaning one bundle.
const options = JSON.parse(workerData).options;

(async function() {
    if (!options.path) {
        throw new Error('Invalid Path: ' + options.path);
    }

    try {
        if (options.settingsModulePath) { // instead of using "settings", use the raw option object as there are many issues w/ the settings module.
            require(options.settingsModulePath)(options);
        } else {
            throw new Error('No settings module path defined!');
        }
    } catch (e) {
        console.error('browserify-middleware bundle-worker init error', e);
        throw e;
    }

    bundle = buildBundle(options.path, options);

    if (options.cache === 'dynamic') {
        // ignoreWatch means that node_modules folders are ignored. This is important for keeping cpu usage reasonable.
        // poll/delay params required to prevent SIGBUS errors on some versions of OSX
        bundle = watchify(bundle, {poll: true, delay: 0, ignoreWatch: true});
        bundle.on('update', async function() {
            await sendLatest();
        });
        bundle.on('error', function(e) {
            console.error('browserify-middleware watchify error', e);
        });
        await sendLatest();
    }
    else {
        await sendLatest();
    }
})();

async function sendLatest() {
    const source = await getSource();
    try {
        parentPort.postMessage(JSON.stringify({
            action: 'latest-bundle-string',
            contents: source
        }));
    }
    catch(e) {
        console.error('Send message failure', e);
    }
}


function minify(str, options) {
    if (!options || typeof options !== 'object') options = {};
    const result = uglify.minify(str, options);
    if (result.error) {
        throw result.error;
    }
    return result;
}

async function getSource() {
    let src = (await new Promise(function (resolve, reject) {
        bundle.bundle(function (err, src) {
            if (err) return reject(err);
            resolve(src);
        });
    })).toString();

    if(options.postcompile) {
        src = await options.postcompile(src);
    }

    if(options.minify && options.preminify) {
        src = await options.preminify(src);
    }

    if(options.minify) {
        try {
            src = minify(src, options.minify).code;
        }
        catch(e) {
            console.error('browserify-middleware bundle-worker minification error', e);
        }
    }

    if(options.minify && options.postminify) {
        src = await options.postminify(src);
    }

    return src;
}
