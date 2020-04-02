'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _utils = require('./utils');

var utils = _interopRequireWildcard(_utils);

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function ajax(url, callback, data) {
  if (data) {
    var reqOptions = typeof url === 'string' ? { uri: url, body: data, json: true } : _extends({}, url, { body: data, json: true });
    _request2.default.post(reqOptions, function (err, res, body) {
      if (err) console.log(err);
      callback(err, body, res);
    });
  } else {
    (0, _request2.default)(url, function (err, res, body) {
      if (err) console.log(err);
      callback(err, body, res);
    });
  }
};

function getDefaults() {
  return {
    loadPath: 'https://api.locize.app/{{projectId}}/{{version}}/{{lng}}/{{ns}}',
    privatePath: 'https://api.locize.app/private/{{projectId}}/{{version}}/{{lng}}/{{ns}}',
    getLanguagesPath: 'https://api.locize.app/languages/{{projectId}}',
    addPath: 'https://api.locize.app/missing/{{projectId}}/{{version}}/{{lng}}/{{ns}}',
    updatePath: 'https://api.locize.app/update/{{projectId}}/{{version}}/{{lng}}/{{ns}}',
    referenceLng: 'en',
    version: 'latest',
    private: false,
    whitelistThreshold: 0.9,
    reloadInterval: 60 * 60 * 1000,
    checkForProjectTimeout: 3 * 1000
  };
}

var Backend = function () {
  function Backend(services) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    var allOptions = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    var callback = arguments[3];

    _classCallCheck(this, Backend);

    if (services && services.projectId) {
      this.init(null, services, allOptions, options);
    } else {
      this.init(services, options, allOptions, callback);
    }

    this.type = 'backend';
  }

  _createClass(Backend, [{
    key: 'init',
    value: function init(services) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var _this = this;

      var allOptions = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
      var callback = arguments[3];

      this.services = services;
      this.options = _extends({}, getDefaults(), this.options, options); // initial
      this.allOptions = allOptions;
      this.somethingLoaded = false;
      this.isProjectNotExisting = false;

      if (typeof callback === 'function') {
        this.getOptions(function (err, opts) {
          if (err) return callback(err);

          _this.options.referenceLng = options.referenceLng || opts.referenceLng || _this.options.referenceLng;
          callback(null, opts);
        });
      }

      this.queuedWrites = { pending: {} };
      this.debouncedProcess = utils.debounce(this.process, 10000);

      if (this.interval) {
        clearInterval(this.interval);
      }
      if (this.options.reloadInterval) {
        this.interval = setInterval(function () {
          _this.reload();
        }, this.options.reloadInterval);
      }
    }
  }, {
    key: 'reload',
    value: function reload() {
      var _this2 = this;

      var _services = this.services,
          backendConnector = _services.backendConnector,
          resourceStore = _services.resourceStore,
          languageUtils = _services.languageUtils,
          logger = _services.logger;

      if (!backendConnector) return;

      var currentLanguage = backendConnector.language;
      if (currentLanguage && currentLanguage.toLowerCase() === 'cimode') return; // avoid loading resources for cimode

      var toLoad = [];

      var append = function append(lng) {
        var lngs = languageUtils.toResolveHierarchy(lng);
        lngs.forEach(function (l) {
          if (toLoad.indexOf(l) < 0) toLoad.push(l);
        });
      };

      append(currentLanguage);

      if (this.allOptions.preload) {
        this.allOptions.preload.forEach(function (l) {
          append(l);
        });
      }

      toLoad.forEach(function (lng) {
        _this2.allOptions.ns.forEach(function (ns) {
          backendConnector.read(lng, ns, 'read', null, null, function (err, data) {
            if (err) logger.warn('loading namespace ' + ns + ' for language ' + lng + ' failed', err);
            if (!err && data) logger.log('loaded namespace ' + ns + ' for language ' + lng, data);

            backendConnector.loaded(lng + '|' + ns, err, data);
          });
        });
      });
    }
  }, {
    key: 'getLanguages',
    value: function getLanguages(callback) {
      var _this3 = this;

      var isMissing = utils.isMissingOption(this.options, ['projectId']);
      if (isMissing) return callback(new Error(isMissing));

      var url = utils.interpolate(this.options.getLanguagesPath, { projectId: this.options.projectId });

      if (this.isProjectNotExisting) return callback(new Error('locize project ' + this.options.projectId + ' does not exist!'));

      this.loadUrl(url, function (err, ret, info) {
        if (!_this3.somethingLoaded && info && info.resourceNotExisting) {
          _this3.isProjectNotExisting = true;
          return callback(new Error('locize project ' + _this3.options.projectId + ' does not exist!'));
        }
        _this3.somethingLoaded = true;
        callback(err, ret);
      });
    }
  }, {
    key: 'getOptions',
    value: function getOptions(callback) {
      var _this4 = this;

      this.getLanguages(function (err, data) {
        if (err) return callback(err);

        var keys = Object.keys(data);
        if (!keys.length) return callback(new Error('was unable to load languages via API'));

        var referenceLng = keys.reduce(function (mem, k) {
          var item = data[k];
          if (item.isReferenceLanguage) mem = k;
          return mem;
        }, '');

        var whitelist = keys.reduce(function (mem, k) {
          var item = data[k];
          if (item.translated[_this4.options.version] && item.translated[_this4.options.version] >= _this4.options.whitelistThreshold) mem.push(k);
          return mem;
        }, []);

        var hasRegion = keys.reduce(function (mem, k) {
          if (k.indexOf('-') > -1) return true;
          return mem;
        }, false);

        callback(null, {
          fallbackLng: referenceLng,
          referenceLng: referenceLng,
          whitelist: whitelist,
          load: hasRegion ? 'all' : 'languageOnly'
        });
      });
    }
  }, {
    key: 'checkIfProjectExists',
    value: function checkIfProjectExists(callback) {
      var logger = this.services.logger;

      if (this.somethingLoaded) {
        if (callback) callback(null);
        return;
      }
      this.getLanguages(function (err) {
        if (err && err.message && err.message.indexOf('does not exist') > 0) {
          if (callback) return callback(err);
          logger.error(err.message);
        }
      });
    }
  }, {
    key: 'read',
    value: function read(language, namespace, callback) {
      var _this5 = this;

      var _ref = this.services || { logger: console },
          logger = _ref.logger;

      var url = void 0;
      if (this.options.private) {
        var isMissing = utils.isMissingOption(this.options, ['projectId', 'version', 'apiKey']);
        if (isMissing) return callback(new Error(isMissing), false);

        url = {
          uri: utils.interpolate(this.options.privatePath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version }),
          headers: {
            'Authorization': this.options.apiKey
          }
        };
      } else {
        var _isMissing = utils.isMissingOption(this.options, ['projectId', 'version']);
        if (_isMissing) return callback(new Error(_isMissing), false);

        url = utils.interpolate(this.options.loadPath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version });
      }

      if (this.isProjectNotExisting) {
        var err = new Error('locize project ' + this.options.projectId + ' does not exist!');
        logger.error(err.message);
        if (callback) callback(err);
        return;
      }

      this.loadUrl(url, function (err, ret, info) {
        if (!_this5.somethingLoaded) {
          if (info && info.resourceNotExisting) {
            setTimeout(function () {
              return _this5.checkIfProjectExists();
            }, _this5.options.checkForProjectTimeout);
          } else {
            _this5.somethingLoaded = true;
          }
        }
        callback(err, ret);
      });
    }
  }, {
    key: 'loadUrl',
    value: function loadUrl(url, callback) {
      ajax(url, function (err, data, res) {
        if (err) return callback(err, true); // retry

        var statusCode = res.statusCode;
        var resourceNotExisting = res.headers['x-cache'] === 'Error from cloudfront';
        if (statusCode && (statusCode === 408 || statusCode === 400)) return callback('failed loading ' + url, true /* retry */, { resourceNotExisting: resourceNotExisting });
        if (statusCode && statusCode >= 500 && statusCode < 600) return callback('failed loading ' + url, true /* retry */, { resourceNotExisting: resourceNotExisting });
        if (statusCode && statusCode >= 400 && statusCode < 500) return callback('failed loading ' + url, false /* no retry */, { resourceNotExisting: resourceNotExisting });

        var ret = void 0;
        try {
          ret = JSON.parse(data);
        } catch (e) {
          err = 'failed parsing ' + url + ' to json';
        }
        if (err) return callback(err, false, { resourceNotExisting: resourceNotExisting });
        callback(null, ret, { resourceNotExisting: resourceNotExisting });
      });
    }
  }, {
    key: 'create',
    value: function create(languages, namespace, key, fallbackValue, callback, options) {
      var _this6 = this;

      this.checkIfProjectExists(function (err) {
        if (err) {
          if (callback) callback(err);
          return;
        }

        // missing options
        var isMissing = utils.isMissingOption(_this6.options, ['projectId', 'version', 'apiKey', 'referenceLng']);
        if (isMissing) return callback(new Error(isMissing));

        if (typeof languages === 'string') languages = [languages];

        languages.forEach(function (lng) {
          if (lng === _this6.options.referenceLng) _this6.queue.call(_this6, _this6.options.referenceLng, namespace, key, fallbackValue, callback, options);
        });
      });
    }
  }, {
    key: 'write',
    value: function write(lng, namespace) {
      var _this7 = this;

      var lock = utils.getPath(this.queuedWrites, ['locks', lng, namespace]);
      if (lock) return;

      var missingUrl = utils.interpolate(this.options.addPath, { lng: lng, ns: namespace, projectId: this.options.projectId, version: this.options.version });
      var updatesUrl = utils.interpolate(this.options.updatePath, { lng: lng, ns: namespace, projectId: this.options.projectId, version: this.options.version });

      var missings = utils.getPath(this.queuedWrites, [lng, namespace]);
      utils.setPath(this.queuedWrites, [lng, namespace], []);

      if (missings.length) {
        // lock
        utils.setPath(this.queuedWrites, ['locks', lng, namespace], true);

        var hasMissing = false;
        var hasUpdates = false;
        var payloadMissing = {};
        var payloadUpdate = {};

        missings.forEach(function (item) {
          var value = item.options && item.options.tDescription ? { value: item.fallbackValue || '', context: { text: item.options.tDescription } } : item.fallbackValue || '';
          if (item.options && item.options.isUpdate) {
            if (!hasUpdates) hasUpdates = true;
            payloadUpdate[item.key] = value;
          } else {
            if (!hasMissing) hasMissing = true;
            payloadMissing[item.key] = value;
          }
        });

        var todo = 0;
        if (hasMissing) todo++;
        if (hasUpdates) todo++;
        var doneOne = function doneOne() {
          todo--;

          if (!todo) {
            // unlock
            utils.setPath(_this7.queuedWrites, ['locks', lng, namespace], false);

            missings.forEach(function (missing) {
              if (missing.callback) missing.callback();
            });

            // rerun
            _this7.debouncedProcess(lng, namespace);
          }
        };

        if (!todo) doneOne();

        if (hasMissing) {
          var reqOptions = {
            uri: missingUrl,
            headers: {
              'Authorization': this.options.apiKey
            }
          };
          ajax(reqOptions, function (err, payloadMissing, res) {
            //const statusCode = xhr.status.toString();
            // TODO: if statusCode === 4xx do log

            doneOne();
          }, payloadMissing);
        }

        if (hasUpdates) {
          var _reqOptions = {
            uri: updatesUrl,
            headers: {
              'Authorization': this.options.apiKey
            }
          };
          ajax(_reqOptions, function (err, payloadUpdate, res) {
            //const statusCode = xhr.status.toString();
            // TODO: if statusCode === 4xx do log

            doneOne();
          }, payloadUpdate);
        }
      }
    }
  }, {
    key: 'process',
    value: function process() {
      var _this8 = this;

      Object.keys(this.queuedWrites).forEach(function (lng) {
        if (lng === 'locks') return;
        Object.keys(_this8.queuedWrites[lng]).forEach(function (ns) {
          var todo = _this8.queuedWrites[lng][ns];
          if (todo.length) {
            _this8.write(lng, ns);
          }
        });
      });
    }
  }, {
    key: 'queue',
    value: function queue(lng, namespace, key, fallbackValue, callback, options) {
      utils.pushPath(this.queuedWrites, [lng, namespace], { key: key, fallbackValue: fallbackValue || '', callback: callback, options: options });

      this.debouncedProcess();
    }
  }]);

  return Backend;
}();

Backend.type = 'backend';

exports.default = Backend;