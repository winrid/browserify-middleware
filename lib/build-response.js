'use strict';

const {Worker} = require('worker_threads');
const prepare = require('prepare-response');

module.exports = function send(path, options) {
    let latestError = null,
        latestPreparedResponse;

    options.path = path;

    function newWorker() {
        let worker = new Worker(__dirname + '/bundle-worker.js', {
            workerData: JSON.stringify({
                options: options
            }),
            resourceLimits: {
                maxYoungGenerationSizeMb: 64
            }
        });
        worker.on('message', function (message) {
            message = JSON.parse(message);
            switch(message.action) {
                case 'latest-bundle-string':
                    const headers = {'content-type': 'application/javascript'};
                    if (options.cache && options.cache !== 'dynamic') {
                        headers['cache-control'] = options.cache;
                    }
                    latestPreparedResponse = prepare(message.contents, headers, {gzip: options.gzip});
                    if(options.postcompile) {
                        options.postcompile(message.contents);
                    }

                    latestError = null;
                    break;
                case 'error':
                    latestError = message.contents;
                    break;
            }
        });
        worker.on('error', function (err) {
            console.error('browserify-middleware - worker error', err);
        });
        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error('browserify-middleware - worker stopped with exit code', code);
                setTimeout(newWorker, 1000);
            }
        });
    }
    newWorker();

    return {
        send: function (req, res, next) {
            function checkNext() {
                if(latestPreparedResponse) {
                    latestPreparedResponse.send(req, res, next);
                }
                else {
                    setTimeout(function() {
                        process.nextTick(checkNext);
                    }, 600);
                }
            }
            checkNext();
        },
        dispose: noop
    };
};

function noop() {
}
