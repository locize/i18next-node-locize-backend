# Introduction

This is a i18next backend to be used node.js. It will load resources from a remote server using request module. It's for the node.js server what the [i18next-xhr-backend](https://github.com/i18next/i18next-xhr-backend) is for the browser.

# Getting started

Source can be loaded via [npm](https://www.npmjs.com/package/i18next-node-remote-backend).

```
$ npm install i18next-node-fs-backend
```

Wiring up:

```js
var i18next = require('i18next');
var Backend = require('i18next-node-remote-backend');

i18next
  .use(Backend)
  .init(i18nextOptions);
```

As with all modules you can either pass the constructor function (class) to the i18next.use or a concrete instance.

## Backend Options

```js
{
  // path where resources get loaded from
  loadPath: '/locales/{{lng}}/{{ns}}.json',

  // path to post missing resources
  addPath: 'locales/add/{{lng}}/{{ns}}',

  // your backend server supports multiloading
  // /locales/resources.json?lng=de+en&ns=ns1+ns2
  allowMultiLoading: false
}
```

Options can be passed in:

**preferred** - by setting options.backend in i18next.init:

```js
var i18next = require('i18next');
var Backend = require('i18next-node-remote-backend');

i18next
  .use(Backend)
  .init({
    backend: options
  });
```

on construction:

```js
var Backend = require('i18next-node-remote-backend');
var backend = new Backend(null, options);
```

by calling init:

```js
var Backend = require('i18next-node-remote-backend');
var backend = new Backend();
backend.init(options);
```
