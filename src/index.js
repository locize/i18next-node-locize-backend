import * as utils from './utils';
import request from 'request';

// https://gist.github.com/Xeoncross/7663273
function ajax(url, callback, data) {
  if (data) {
    request.post({url: url, body: body, json: true}, function(err, res, body) {
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
    loadPath: '/locales/{{lng}}/{{ns}}.json',
    addPath: 'locales/add/{{lng}}/{{ns}}',
    referenceLng: 'en',
    version: 'latest'
  };
}

class Backend {
  constructor(services, options = {}) {
    this.init(services, options);

    this.type = 'backend';
  }

  init(services, options = {}) {
    this.services = services;
    this.options = {...getDefaults(), ...this.options, ...options};

    this.queuedWrites = {};
    this.debouncedWrite = utils.debounce(this.write, 10000);
  }

  read(language, namespace, callback) {
    let url = this.services.interpolator.interpolate(this.options.loadPath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version });

    this.loadUrl(url, callback);
  }

  loadUrl(url, callback) {
    ajax(url, (err, data, res) => {
      if (err) return callback(err, true); // retry

      const statusCode = res.statusCode && res.statusCode.toString();
      if (statusCode && statusCode.indexOf('5') === 0) return callback('failed loading ' + url, true /* retry */);
      if (statusCode && statusCode.indexOf('4') === 0) return callback('failed loading ' + url, false /* no retry */);

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
        url: url,
        headers: {
          'Authorization': this.options.apiKey
        }
      };

      ajax(reqOptions, function(err, data, res) {
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
