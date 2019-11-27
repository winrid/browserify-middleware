const uglify = require('uglify-es');
const watchify = require('watchify');
const prepare = require('prepare-response');
const buildBundle = require('./build-bundle');

const {
    parentPort, workerData
} = require('worker_threads');

let bundle = null; // this worker is responsible for one path - meaning one bundle.
const options = JSON.parse(workerData).options;

(async function() {
    console.log('INIT FOR PATH', options.path);

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
    console.log('BUILT BUNDLE');

    if (options.cache === 'dynamic') {
        await sendLatest();
        bundle = watchify(bundle, {poll: true, delay: 0});
        bundle.on('update', async function() {
            console.log('GOT AN UPDATE');
            await sendLatest();
        });
        bundle.on('error', function(e) {
            console.error('browserify-middleware watchify error', e);
        });
    }
    else {
        console.log('BUNDLE - DO-AND-FORGET');
        await sendLatest();
    }
})();

async function sendLatest() {
    const response = await getResponse();
    console.log('response size', response.length);
    parentPort.postMessage(JSON.stringify({
        action: 'latest-bundle-string',
        contents: response
    }));
}


function minify(str, options) {
    if (!options || typeof options !== 'object') options = {};
    const result = uglify.minify(str, options);
    if (result.error) {
        throw result.error;
    }
    return result;
}

async function getResponse() {
    var headers = {'content-type': 'application/javascript'};
    if (options.cache && options.cache !== 'dynamic') {
        headers['cache-control'] = options.cache;
    }

    // return await prepare(await getSource(), headers, {gzip: options.gzip});
    return await getSource();
}

async function getSource() {
    let src = (await new Promise(function (resolve, reject) {
        bundle.bundle(function (err, src) {
            if (err) return reject(err);
            resolve(src);
        });
    })).toString();

    console.log('getSource src so far', src.length);

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

    console.log('getSource src', src.length);

    return src;
}
