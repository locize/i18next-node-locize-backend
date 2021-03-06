import * as utils from './utils';
import request from 'request';

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

class Backend {
  constructor(services, options = {}, allOptions = {}, callback) {
    if (services && services.projectId) {
      this.init(null, services, allOptions, options);
    } else {
      this.init(services, options, allOptions, callback);
    }

    this.type = 'backend';
  }

  init(services, options = {}, allOptions = {}, callback) {
    this.services = services;
    this.options = {...getDefaults(), ...this.options, ...options}; // initial
    this.allOptions = allOptions;
    this.somethingLoaded = false;
    this.isProjectNotExisting = false;

    if (typeof callback === 'function') {
      this.getOptions((err, opts) => {
        if (err) return callback(err);

        this.options.referenceLng = options.referenceLng || opts.referenceLng || this.options.referenceLng;
        callback(null, opts);
      });
    }

    this.queuedWrites = { pending: {} };
    this.debouncedProcess = utils.debounce(this.process, 10000);

    if (this.interval) {
      clearInterval(this.interval);
    }
    if (this.options.reloadInterval) {
      this.interval = setInterval(() => {
        this.reload();
      }, this.options.reloadInterval);
    }
  }

  reload() {
    const { backendConnector, resourceStore, languageUtils, logger } = this.services;
    if (!backendConnector) return;

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
    const isMissing = utils.isMissingOption(this.options, ['projectId']);
    if (isMissing) return callback(new Error(isMissing));

    let url = utils.interpolate(this.options.getLanguagesPath, { projectId: this.options.projectId });

    if (this.isProjectNotExisting) return callback(new Error(`locize project ${this.options.projectId} does not exist!`));

    this.loadUrl(url, (err, ret, info) => {
      if (!this.somethingLoaded && info && info.resourceNotExisting) {
        this.isProjectNotExisting = true;
        return callback(new Error(`locize project ${this.options.projectId} does not exist!`));
      }
      this.somethingLoaded = true;
      callback(err, ret)
    });
  }

  getOptions(callback) {
    this.getLanguages((err, data) => {
      if (err) return callback(err);

      const keys = Object.keys(data);
      if (!keys.length) return callback(new Error('was unable to load languages via API'));

      const referenceLng = keys.reduce((mem, k) => {
        const item = data[k];
        if (item.isReferenceLanguage) mem = k;
        return mem;
      }, '');

      const whitelist = keys.reduce((mem, k) => {
        const item = data[k];
        if (item.translated[this.options.version] && item.translated[this.options.version] >= this.options.whitelistThreshold) mem.push(k)
        return mem;
      }, []);

      const hasRegion = keys.reduce((mem, k) => {
        if (k.indexOf('-') > -1) return true;
        return mem;
      }, false);

      callback(null, {
        fallbackLng: referenceLng,
        referenceLng,
        whitelist,
        load: hasRegion ? 'all' : 'languageOnly'
      });
    });
  }

  checkIfProjectExists(callback) {
    const { logger } = this.services;
    if (this.somethingLoaded) {
      if (callback) callback(null);
      return;
    }
    if (this.alreadyRequestedCheckIfProjectExists) {
      setTimeout(() => this.checkIfProjectExists(callback), this.options.checkForProjectTimeout);
      return;
    }
    this.alreadyRequestedCheckIfProjectExists = true;
    this.getLanguages((err) => {
      if (err && err.message && err.message.indexOf('does not exist') > 0) {
        if (callback) return callback(err);
        logger.error(err.message);
      }
    });
  }

  read(language, namespace, callback) {
    const { logger } = this.services || { logger: console };
    let url;
    if (this.options.private) {
      const isMissing = utils.isMissingOption(this.options, ['projectId', 'version', 'apiKey'])
      if (isMissing) return callback(new Error(isMissing), false);

      url = {
        uri: utils.interpolate(this.options.privatePath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version }),
        headers: {
          'Authorization': this.options.apiKey
        }
      };
    } else {
      const isMissing = utils.isMissingOption(this.options, ['projectId', 'version'])
      if (isMissing) return callback(new Error(isMissing), false);

      url = utils.interpolate(this.options.loadPath, { lng: language, ns: namespace, projectId: this.options.projectId, version: this.options.version });
    }

    if (this.isProjectNotExisting) {
      const err = new Error(`locize project ${this.options.projectId} does not exist!`);
      logger.error(err.message);
      if (callback) callback(err);
      return;
    }

    this.loadUrl(url, (err, ret, info) => {
      if (!this.somethingLoaded) {
        if (info && info.resourceNotExisting) {
          setTimeout(() => this.checkIfProjectExists(), this.options.checkForProjectTimeout);
        } else {
          this.somethingLoaded = true;
        }
      }
      callback(err, ret)
    });
  }

  loadUrl(url, callback) {
    ajax(url, (err, data, res) => {
      if (err) return callback(err, true); // retry

      const statusCode = res.statusCode;
      const resourceNotExisting = res.headers['x-cache'] === 'Error from cloudfront'
      if (statusCode && (statusCode === 408 || statusCode === 400)) return callback('failed loading ' + url, true /* retry */, { resourceNotExisting });
      if (statusCode && statusCode >= 500 && statusCode < 600) return callback('failed loading ' + url, true /* retry */, { resourceNotExisting });
      if (statusCode && statusCode >= 400 && statusCode < 500) return callback('failed loading ' + url, false /* no retry */, { resourceNotExisting });

      let ret;
      try {
        ret = JSON.parse(data);
      } catch (e) {
        err = 'failed parsing ' + url + ' to json';
      }
      if (err) return callback(err, false, { resourceNotExisting });
      callback(null, ret, { resourceNotExisting });
    });
  }

  create(languages, namespace, key, fallbackValue, callback, options) {
    this.checkIfProjectExists((err) => {
      if (err) {
        if (callback) callback(err);
        return;
      }

      // missing options
      const isMissing = utils.isMissingOption(this.options, ['projectId', 'version', 'apiKey', 'referenceLng'])
      if (isMissing) return callback(new Error(isMissing));

      if (typeof languages === 'string') languages = [languages];

      languages.forEach(lng => {
        if (lng === this.options.referenceLng) this.queue.call(this, this.options.referenceLng, namespace, key, fallbackValue, callback, options);
      });
    });
  }

  writePage(lng, namespace, missings, callback) {
    let missingUrl = utils.interpolate(this.options.addPath, { lng: lng, ns: namespace, projectId: this.options.projectId, version: this.options.version });
    let updatesUrl = utils.interpolate(this.options.updatePath, { lng: lng, ns: namespace, projectId: this.options.projectId, version: this.options.version });

    let hasMissing= false;
    let hasUpdates = false;
    const payloadMissing = {};
    const payloadUpdate = {};

    missings.forEach(item => {
      const value = (item.options && item.options.tDescription) ? { value: item.fallbackValue || '', context: { text: item.options.tDescription } } : item.fallbackValue || ''
      if (item.options && item.options.isUpdate) {
        if (!hasUpdates) hasUpdates = true;
        payloadUpdate[item.key] = value;
      } else {
        if (!hasMissing) hasMissing = true;
        payloadMissing[item.key] = value;
      }
    });

    let todo = 0;
    if (hasMissing) todo++;
    if (hasUpdates) todo++;
    const doneOne = () => {
      todo--;
      if (!todo) callback()
    };

    if (!todo) doneOne();

    if (hasMissing) {
      const reqOptions = {
        uri: missingUrl,
        headers: {
          'Authorization': this.options.apiKey
        }
      };
      ajax(reqOptions, (err, payloadMissing, res) => {
        //const statusCode = xhr.status.toString();
        // TODO: if statusCode === 4xx do log

        doneOne();
      }, payloadMissing);
    }

    if (hasUpdates) {
      const reqOptions = {
        uri: updatesUrl,
        headers: {
          'Authorization': this.options.apiKey
        }
      };
      ajax(reqOptions, (err, payloadUpdate, res) => {
        //const statusCode = xhr.status.toString();
        // TODO: if statusCode === 4xx do log

        doneOne();
      }, payloadUpdate);
    }
  }

  write(lng, namespace) {
    let lock = utils.getPath(this.queuedWrites, ['locks', lng, namespace]);
    if (lock) return;

    let missings = utils.getPath(this.queuedWrites, [lng, namespace]);
    utils.setPath(this.queuedWrites, [lng, namespace], []);
    const pageSize = 1000;

    if (missings.length) {
      // lock
      utils.setPath(this.queuedWrites, ['locks', lng, namespace], true);

      const namespaceSaved = () => {
        // unlock
        utils.setPath(this.queuedWrites, ['locks', lng, namespace], false);

        missings.forEach((missing) => {
          if (missing.callback) missing.callback();
        });

        // rerun
        this.debouncedProcess(lng, namespace);
      };

      const amountOfPages = missings.length / pageSize;
      let pagesDone = 0;

      let page = missings.splice(0, pageSize);
      this.writePage(lng, namespace, page, () => {
        pagesDone++;
        if (pagesDone >= amountOfPages) namespaceSaved();
      });
      while (page.length === pageSize) {
        page = missings.splice(0, pageSize);
        if (page.length) this.writePage(lng, namespace, page, () => {
          pagesDone++;
          if (pagesDone >= amountOfPages) namespaceSaved();
        });
      }
    }
  }

  process() {
    Object.keys(this.queuedWrites).forEach((lng) => {
      if (lng === 'locks') return;
      Object.keys(this.queuedWrites[lng]).forEach((ns) => {
        const todo = this.queuedWrites[lng][ns];
        if (todo.length) {
          this.write(lng, ns);
        }
      });
    });
  }

  queue(lng, namespace, key, fallbackValue, callback, options) {
    utils.pushPath(this.queuedWrites, [lng, namespace], {key: key, fallbackValue: fallbackValue || '', callback: callback, options});

    this.debouncedProcess();
  }
}

Backend.type = 'backend';


export default Backend;
