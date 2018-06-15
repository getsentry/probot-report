const { isDryRun } = require('dryrun');
const _ = require('lodash');
const yaml = require('js-yaml');
const defaults = require('./defaults');

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
const WRITE_DELAY = 10000;

module.exports = class Config {
  constructor(robot, installation) {
    this.robot = robot;
    this.installation = installation;
    this.logger = robot.log;
    this.data = null;
    this.sha = null;

    this.writeDebounced = _.debounce(this.write, WRITE_DELAY);
  }

  getContext() {
    return {
      owner: this.installation.account.login,
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

  getGithub() {
    return this.robot.auth(this.installation.id);
  }

  async loadChanges(context) {
    if (this.getContext().repo === context.repo().repo) {
      await this.load();
      return true;
    }

    return false;
  }

  async load() {
    const context = this.getContext();
    const { owner, repo, path } = context;
    this.logger.info(`Loading config from ${owner}/${repo}:${path}`);

    try {
      const github = await this.getGithub();
      const result = await github.repos.getContent(context);
      const config = yaml.safeLoad(
        Buffer.from(result.data.content, 'base64').toString()
      );

      this.data = { ...defaults, ...config };
      this.sha = result.data.sha;
    } catch (err) {
      this.logger.error(`Could not read ${owner}/${repo}:${path}`, err);
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
    const { owner, repo, path } = context;
    this.logger.info(`Persisting config to ${owner}/${repo}:${path}`);

    if (isDryRun()) {
      this.logger.debug('Config write skipped due to dry run');
      return;
    }

    try {
      const data = yaml.safeDump(this.data, {
        styles: { '!!null': 'canonical' },
        sortKeys: true,
      });

      const params = {
        ...context,
        message: 'meta: Update config',
        content: Buffer.from(data).toString('base64'),
        sha: this.sha,
      };

      const github = await this.getGithub();
      const response = this.sha
        ? await github.repos.updateFile(params)
        : await github.repos.createFile(params);

      this.original = this.data;
      this.sha = response.data.content.sha;
    } catch (err) {
      this.logger.error(`Could not write to ${owner}/${repo}:${path}`, err);
    }
  }

  save() {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    this.writeDebounced();
    return this;
  }

  mergeIn(path, data) {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    if (path.length === 0) {
      return this.merge(data);
    }

    const keys = _.keys(data).join(',');
    this.logger.debug(`Merging keys {${keys}} into config.${path.join('.')}`);
    const nested = _.get(this.data, path);
    _.set(this.data, path, { ...nested, ...data });
    return this.save();
  }

  merge(data) {
    if (!this.data) {
      throw new Error('Config not loaded');
    }

    this.logger.debug(`Merging keys {${_.keys(data).join(',')}} into config`);
    this.data = { ...this.data, ...data };
    return this.save();
  }

  mergeUser(id, data) {
    return this.mergeIn(['users', id], data);
  }
};
