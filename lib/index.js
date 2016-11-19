'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj['default'] = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _utils = require('./utils');

var utils = _interopRequireWildcard(_utils);

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

// https://gist.github.com/Xeoncross/7663273
function ajax(url, callback, data) {
  if (data) {
    _request2['default'].post({ uri: url, body: data, json: true }, function (err, res, body) {
      if (err) console.log(err);
      callback(err, body, res);
    });
  } else {
    (0, _request2['default'])(url, function (err, res, body) {
      if (err) console.log(err);
      callback(err, body, res);
    });
  }
};

function getDefaults() {
  return {
    loadPath: 'https://api.locize.io/{{projectId}}/{{version}}/{{lng}}/{{ns}}',
    getLanguagesPath: 'https://api.locize.io/languages/{{projectId}}',
    addPath: 'https://api.locize.io/missing/{{projectId}}/{{version}}/{{lng}}/{{ns}}',
    referenceLng: 'en',
    version: 'latest',
    reloadInterval: 60 * 60 * 1000
  };
}

var Backend = (function () {
  function Backend(services) {
    var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
    var allOptions = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

    _classCallCheck(this, Backend);

    this.init(services, options, allOptions);

    this.type = 'backend';
  }

  _createClass(Backend, [{
    key: 'init',
    value: function init(services) {
      var _this = this;

      var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
      var allOptions = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

      this.services = services;
      this.options = _extends({}, getDefaults(), this.options, options);
      this.allOptions = allOptions;

      this.queuedWrites = {};
      this.debouncedWrite = utils.debounce(this.write, 10000);

      if (this.options.reloadInterval) {
        setInterval(function () {
          _this.reload();
        }, this.options.reloadInterval);
      }
    }
  }, {
    key: 'reload',
    value: function reload() {
      var _this2 = this;

      var _services = this.services;
      var backendConnector = _services.backendConnector;
      var resourceStore = _services.resourceStore;
      var languageUtils = _services.languageUtils;
      var logger = _services.logger;

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
      var url = this.services.interpolator.interpolate(this.options.getLanguagesPath, { projectId: this.options.projectId });

      this.loadUrl(url, callback);
    }
  }, {
    key: 'read',
    value: function read(language, namespace, callback) {
      var url = this.services.interpolator.interpolate(this.options.loadPath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version });

      this.loadUrl(url, callback);
    }
  }, {
    key: 'loadUrl',
    value: function loadUrl(url, callback) {
      ajax(url, function (err, data, res) {
        if (err) return callback(err, true); // retry

        var statusCode = res.statusCode;
        if (statusCode && statusCode >= 500 && statusCode < 600) return callback('failed loading ' + url, true /* retry */);
        if (statusCode && statusCode >= 400 && statusCode < 500) return callback('failed loading ' + url, false /* no retry */);

        var ret = undefined;
        try {
          ret = JSON.parse(data);
        } catch (e) {
          err = 'failed parsing ' + url + ' to json';
        }
        if (err) return callback(err, false);
        callback(null, ret);
      });
    }
  }, {
    key: 'create',
    value: function create(languages, namespace, key, fallbackValue, callback) {
      var _this3 = this;

      if (!callback) callback = function () {};
      if (typeof languages === 'string') languages = [languages];

      languages.forEach(function (lng) {
        if (lng === _this3.options.referenceLng) _this3.queue.call(_this3, _this3.options.referenceLng, namespace, key, fallbackValue, callback);
      });
    }
  }, {
    key: 'write',
    value: function write(lng, namespace) {
      var _this4 = this;

      var lock = utils.getPath(this.queuedWrites, ['locks', lng, namespace]);
      if (lock) return;

      var url = this.services.interpolator.interpolate(this.options.addPath, { lng: lng, ns: namespace, projectId: this.options.projectId, version: this.options.version });

      var missings = utils.getPath(this.queuedWrites, [lng, namespace]);
      utils.setPath(this.queuedWrites, [lng, namespace], []);

      if (missings.length) {
        (function () {
          // lock
          utils.setPath(_this4.queuedWrites, ['locks', lng, namespace], true);

          var payload = {};
          missings.forEach(function (item) {
            payload[item.key] = item.fallbackValue || '';
          });

          var reqOptions = {
            uri: url,
            headers: {
              'Authorization': _this4.options.apiKey
            }
          };

          ajax(reqOptions, function (err, data, res) {
            //const statusCode = xhr.status.toString();
            // TODO: if statusCode === 4xx do log

            // unlock
            utils.setPath(_this4.queuedWrites, ['locks', lng, namespace], false);

            missings.forEach(function (missing) {
              if (missing.callback) missing.callback();
            });

            // rerun
            _this4.debouncedWrite(lng, namespace);
          }, payload);
        })();
      }
    }
  }, {
    key: 'queue',
    value: function queue(lng, namespace, key, fallbackValue, callback) {
      utils.pushPath(this.queuedWrites, [lng, namespace], { key: key, fallbackValue: fallbackValue || '', callback: callback });

      this.debouncedWrite(lng, namespace);
    }
  }]);

  return Backend;
})();

Backend.type = 'backend';

exports['default'] = Backend;
module.exports = exports['default'];