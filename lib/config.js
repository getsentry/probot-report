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
 * Current SHA of the config file, if it exists. Otherwise null.
 */
let configFileSha = null;

module.exports = class ConfigMananger {
  getContext(account) {
    return {
      owner: account.login,
      repo: process.env.SETTINGS_REPO || DEFAULT_SETTINGS_REPO,
      path: process.env.SETTINGS_PATH || DEFAULT_SETTINGS_PATH,
    };
  }

  async loadConfig(github, account) {
    const context = this.getContext(account);
    try {
      const result = await github.repos.getContent(context);
      configFileSha = result.data.sha;
      const config = yaml.safeLoad(Buffer.from(result.data.content, 'base64').toString());
      return { ...defaults, ...config };
    } catch (err) {
      // TODO: log error to sentry here
      console.error(`Could not read ${context.owner}/${context.repo}:${context.path}`);
      return defaults;
    }
  }

  async writeConfig(github, account, config) {
    if (isDryRun()) {
      return;
    }

    const context = this.getContext(account);

    try {
      const newConfig = yaml.safeDump(config, {
        styles: { '!!null': 'canonical' },
        sortKeys: true,
      });

      const params = {
        ...context,
        message: 'meta: Update config',
        content: new Buffer(newConfig).toString('base64'),
        sha: configFileSha,
      };

      const response = (configFileSha)
        ? (await github.repos.updateFile(params))
        : (await github.repos.createFile(params));

      configFileSha = response.data.content.sha;
    } catch (err) {
      // TODO: log error to sentry here
      console.error(`Could not write to ${context.owner}/${context.repo}:${context.path}`);
    }
  }

  async updateUser(github, account, githubUsername, data) {
    const config = await this.loadConfig(github, account);
    if (config.users[githubUsername]) {
      config.users[githubUsername] = { ...config.users[githubUsername], ...data };
    }
  }
};
