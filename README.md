# Introduction

This is a i18next backend to be used with node.js for the [locize](http://locize.com) service. It's for the node.js server what the [i18next-locize-backend](https://github.com/locize/i18next-locize-backend) is for the browser.

# Getting started

Source can be loaded via [npm](https://www.npmjs.com/package/i18next-node-locize-backend).

```
$ npm install i18next-node-locize-backend
```

Wiring up:

```js
var i18next = require('i18next');
var Backend = require('i18next-node-locize-backend');

i18next
  .use(Backend)
  .init(i18nextOptions);
```

As with all modules you can either pass the constructor function (class) to the i18next.use or a concrete instance.

## Backend Options

```js
{
  // the id of your locize project
  projectId: '[PROJECTID]',

  // add an api key if you want to send missing keys
  apiKey: '[APIKEY]',

  // the reference language of your project
  referenceLng: '[LNG]',

  // version - defaults to latest
  version: '[VERSION]'
}
```

Options can be passed in:

**preferred** - by setting options.backend in i18next.init:

```js
var i18next = require('i18next');
var Backend = require('i18next-node-locize-backend');

i18next
  .use(Backend)
  .init({
    backend: options
  });
```

on construction:

```js
var Backend = require('i18next-node-locize-backend');
var backend = new Backend(options);
```

by calling init:

```js
var Backend = require('i18next-node-locize-backend');
var backend = new Backend();
backend.init(options);
```


## Additional API endpoints

### backend.getLanguages

Will return a list of all languages in your project including percentage of translations done per version.

```js
import Backend from 'i18next-node-locize-backend';
const backend = new Backend(options);

backend.getLanguages((err, data) => {
  /*
  data is:

  {
    "en": {
      "name": "English",
      "nativeName": "English",
      "isReferenceLanguage": true,
      "translated": {
        "latest": 1
      }
    },
    "de": {
      "name": "German",
      "nativeName": "Deutsch",
      "isReferenceLanguage": false,
      "translated": {
        "latest": 0.9
      }
    }
  }
  */
});

// or
i18next.services.backendConnector.backend.getLanguages(callback);
```

### backend.getOptions

Will return an object containing useful informations for the i18next init options.

```js
import Backend from 'i18next-node-locize-backend';
const backend = new Backend(options);

backend.getOptions((err, data) => {
  /*
  data is:

  {
    fallbackLng: 'en',
    referenceLng: 'en',
    whitelist: ['en', 'de'],
    load: 'languageOnly|all' // depending on your whitelist has locals having region like en-US
  }
  */
});

// or
i18next.services.backendConnector.backend.getOptions(callback);
```

You can set a threshold for languages to be added to whitelist by setting whitelistThreshold in backend options (eg: 1 = 100% translated, 0.9 = 90% translated).

## SPECIAL - let the backend determine some options to improve loading

You can load some information from the backend to eg. set whitelist for i18next just supporting languages you got in your locize project.

You will get i18next options for (same as above backend.getOptions):

- fallbackLng
- whitelist
- load

```js
import i18next from 'i18next';
import Backend from 'i18next-node-locize-backend';

const backend = new Backend({
  projectId: '[PROJECTID]',
  apiKey: '[APIKEY]',
  version: '[VERSION]',
  // referenceLng -> not needed as will be loaded from API
}, (err, opts) => {
  i18next
    .use(backend)
    .init({ ...opts, ...yourOptions}); // yourOptions should not include backendOptions!
});
```
