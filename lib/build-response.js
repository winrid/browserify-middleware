'use strict';

const Promise = require('promise');
const prepare = require('prepare-response');
const workerFarm = require('worker-farm');
// create worker with path/options
const browserifyWorker = workerFarm(require.resolve('./bundle-worker'), [
    'init',
    'getSource',
    'notifyOnUpdate',
    'closeBundle',
    'start'
]);

module.exports = function send(path, options) {
    options.path = path;

    if (!options.cache) {
        return {
            send: function (req, res, next) {
                getResponse(browserifyWorker, options).send(req, res, next);
            },
            dispose: noop
        };
    } else if (options.cache === 'dynamic') {
        var response, resolve;
        var updatingTimeout;
        browserifyWorker.notifyOnUpdate(JSON.stringify(options), function () {
            if (resolve) {
                clearTimeout(updatingTimeout);
            } else {
                response = new Promise(function (_resolve) {
                    resolve = _resolve;
                });
            }
            updatingTimeout = setTimeout(function rebuild() {
                resolve(getResponse(browserifyWorker, options));
                resolve = undefined;
            }, 600);
        });
        response = Promise.resolve(getResponse(browserifyWorker, options));
        return {
            send: function (req, res, next) {
                response.done(function (response) {
                    response.send(req, res, next);
                }, next);
            },
            dispose: function () {
                browserifyWorker.closeBundle(path, noop);
            }
        };
    } else {
        return getResponse(browserifyWorker, options);
    }
};

function getResponse(worker, options) {
    var headers = {'content-type': 'application/javascript'};
    if (options.cache && options.cache !== 'dynamic') {
        headers['cache-control'] = options.cache;
    }
    const response = new Promise(function (resolve, reject) {
        worker.getSource(JSON.stringify(options), function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    }).then(function (src) {
        return prepare(src, headers, {gzip: options.gzip})
    }).then(function (response) {
        return syncResponse = response;
    });
    var syncResponse;
    return {
        send: function (req, res, next) {
            if (syncResponse) return syncResponse.send(req, res);
            else return response.done(function (response) {
                response.send(req, res);
            }, next);
        },
        dispose: noop
    };
}

function noop() {
}
