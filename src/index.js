import * as utils from './utils';
import request from 'request';

// https://gist.github.com/Xeoncross/7663273
function ajax(url, callback, data) {
  if (data) {
    let reqOptions = typeof url === 'string' ? { uri: url, body: data, json: true } : { ...url, ...{ body: data, json: true }};
    request.post(reqOptions, function(err, res, body) {
      if (err) console.log(err);
      callback(err, body, res);
    });
  } else {
    request(url, function(err, res, body) {
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

class Backend {
  constructor(services, options = {}, allOptions = {}) {
    this.init(services, options, allOptions);

    this.type = 'backend';
  }

  init(services, options = {}, allOptions = {}) {
    this.services = services;
    this.options = {...getDefaults(), ...this.options, ...options};
    this.allOptions = allOptions;

    this.queuedWrites = {};
    this.debouncedWrite = utils.debounce(this.write, 10000);

    if (this.options.reloadInterval) {
      setInterval(() => {
        this.reload();
      }, this.options.reloadInterval);
    }
  }

  reload() {
    const { backendConnector, resourceStore, languageUtils, logger } = this.services;

    const currentLanguage = backendConnector.language;
    if (currentLanguage && currentLanguage.toLowerCase() === 'cimode') return; // avoid loading resources for cimode

    let toLoad = [];

    let append = lng => {
      let lngs = languageUtils.toResolveHierarchy(lng);
      lngs.forEach(l => {
        if (toLoad.indexOf(l) < 0) toLoad.push(l);
      });
    };

    append(currentLanguage);

    if (this.allOptions.preload) {
      this.allOptions.preload.forEach(l => {
        append(l);
      });
    }

    toLoad.forEach(lng => {
      this.allOptions.ns.forEach(ns => {
        backendConnector.read(lng, ns, 'read', null, null, (err, data) => {
          if (err) logger.warn(`loading namespace ${ns} for language ${lng} failed`, err);
          if (!err && data) logger.log(`loaded namespace ${ns} for language ${lng}`, data);

          backendConnector.loaded(`${lng}|${ns}`, err, data);
        });
      });
    });
  }

  getLanguages(callback) {
    let url = this.services.interpolator.interpolate(this.options.getLanguagesPath, { projectId: this.options.projectId });

    this.loadUrl(url, callback);
  }

  read(language, namespace, callback) {
    let url = this.services.interpolator.interpolate(this.options.loadPath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version });

    this.loadUrl(url, callback);
  }

  loadUrl(url, callback) {
    ajax(url, (err, data, res) => {
      if (err) return callback(err, true); // retry

      const statusCode = res.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) return callback('failed loading ' + url, true /* retry */);
      if (statusCode && statusCode >= 400 && statusCode < 500) return callback('failed loading ' + url, false /* no retry */);

      let ret;
      try {
        ret = JSON.parse(data);
      } catch (e) {
        err = 'failed parsing ' + url + ' to json';
      }
      if (err) return callback(err, false);
      callback(null, ret);
    });
  }

  create(languages, namespace, key, fallbackValue, callback) {
    if (!callback) callback = () => {};
    if (typeof languages === 'string') languages = [languages];

    languages.forEach(lng => {
      if (lng === this.options.referenceLng) this.queue.call(this, this.options.referenceLng, namespace, key, fallbackValue, callback);
    });
  }

  write(lng, namespace) {
    let lock = utils.getPath(this.queuedWrites, ['locks', lng, namespace]);
    if (lock) return;

    let url = this.services.interpolator.interpolate(this.options.addPath, { lng: lng, ns: namespace, projectId: this.options.projectId, version: this.options.version });

    let missings = utils.getPath(this.queuedWrites, [lng, namespace]);
    utils.setPath(this.queuedWrites, [lng, namespace], []);

    if (missings.length) {
      // lock
      utils.setPath(this.queuedWrites, ['locks', lng, namespace], true);

      const payload = {};
      missings.forEach(item => {
        payload[item.key] = item.fallbackValue || '';
      });

      const reqOptions = {
        uri: url,
        headers: {
          'Authorization': this.options.apiKey
        }
      };

      ajax(reqOptions,(err, data, res) => {
        //const statusCode = xhr.status.toString();
        // TODO: if statusCode === 4xx do log

        // unlock
        utils.setPath(this.queuedWrites, ['locks', lng, namespace], false);

        missings.forEach((missing) => {
          if (missing.callback) missing.callback();
        });

        // rerun
        this.debouncedWrite(lng, namespace);
      }, payload);
    }
  }

  queue(lng, namespace, key, fallbackValue, callback) {
    utils.pushPath(this.queuedWrites, [lng, namespace], {key: key, fallbackValue: fallbackValue || '', callback: callback});

    this.debouncedWrite(lng, namespace);
  }
}

Backend.type = 'backend';


export default Backend;
