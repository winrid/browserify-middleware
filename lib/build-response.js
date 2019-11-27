'use strict';

const {Worker} = require('worker_threads');

module.exports = function send(path, options) {
    let latestBundleString = null,
        latestError = null;

    options.path = path;

    function newWorker() {
        let worker = new Worker(__dirname + '/bundle-worker.js', {
            workerData: JSON.stringify({
                options: options
            })
        });
        worker.on('message', function (message) {
            message = JSON.parse(message);
            console.log('GOT MESSAGE', message.contents.length);
            switch(message.action) {
                case 'latest-bundle-string':
                    latestBundleString = message.contents;

                    latestError = null;
                    break;
                case 'error':
                    latestBundleString = null;
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
                if(latestBundleString) {
                    res.send(latestBundleString);
                }
                else if(latestError) {
                    res.send(latestError);
                    next();
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
