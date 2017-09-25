const _ = require('lodash');
const yaml = require('js-yaml');
const defaults = require('./defaults');
const { isDryRun } = require('./utils');

/**
 * Default repository to look for organization-wide settings.
 * Can be overridden with the SETTINGS_REPO environment variable.
 */
const DEFAULT_SETTINGS_REPO = 'probot-settings';

/**
 * Default path of the config file within the settings repo.
 * Can be overridden with the SETTINGS_PATH environment variable.
 */
const DEFAULT_SETTINGS_PATH = '.github/report.yml';

/**
 * Delay before writing the config to the settings repo
 */
const WRITE_DELAY = 600000;

module.exports = class Config {
  constructor(github, account) {
    this.github = github;
    this.account = account;
    this.data = null;
    this.sha = null;

    this.writeDebounced = _.debounce(this.write, WRITE_DELAY);
  }

  getContext() {
    return {
      owner: this.account.login,
      repo: process.env.SETTINGS_REPO || DEFAULT_SETTINGS_REPO,
      path: process.env.SETTINGS_PATH || DEFAULT_SETTINGS_PATH,
    };
  }

  get() {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    return { ...this.data };
  }

  async load() {
    const context = this.getContext();

    try {
      const result = await this.github.repos.getContent(context);
      const config = yaml.safeLoad(Buffer.from(result.data.content, 'base64').toString());

      this.data = { ...defaults, ...config };
      this.sha = result.data.sha;
    } catch (err) {
      // TODO: log error to sentry here
      console.error(`Could not read ${context.owner}/${context.repo}:${context.path}`);
      this.data = { ...defaults };
      this.sha = null;
    }

    return this;
  }

  async write() {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    const context = this.getContext();

    try {
      const data = yaml.safeDump(this.data, {
        styles: { '!!null': 'canonical' },
        sortKeys: true,
      });

      const params = {
        ...context,
        message: 'meta: Update config',
        content: new Buffer(data).toString('base64'),
        sha: this.sha,
      };

      const response = (this.sha)
        ? (await this.github.repos.updateFile(params))
        : (await this.github.repos.createFile(params));

      this.sha = response.data.content.sha;
    } catch (err) {
      // TODO: log error to sentry here
      console.error(`Could not write to ${context.owner}/${context.repo}:${context.path}`);
    }
  }

  save() {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    if (isDryRun()) {
      return this;
    }

    this.writeDebounced();
    return this;
  }

  mergeIn(path, data) {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    const nested = _.get(this.data, path);
    this.data = _.set(this.data, path, { ...nested, ...data });
    return this.save();
  }

  merge(data) {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    this.data = { ...this.data, ...data };
    return this.save();
  }

  mergeUser(id, data) {
    return this.mergeIn(['users', id], data);
  }
};
