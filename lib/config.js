const yaml = require('js-yaml');

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

function getContext(account) {
  const owner = account.login;
  const repo = process.env.SETTINGS_REPO || DEFAULT_SETTINGS_REPO;
  const path = process.env.SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
  return { owner, repo, path };
}

let configFileSha = null;

module.exports = {
  loadConfig: async function loadConfig(github, account) {
    try {
      const result = await github.repos.getContent(getContext(account));
      configFileSha = result.data.sha;
      return yaml.safeLoad(Buffer.from(result.data.content, 'base64').toString()) || {};
    } catch (err) {
      console.error(err);
      // TODO: log error to sentry here
      return {};
    }
  },
  writeConfig: async function writeConfig(github, account, config) {
    try {
      const newConfig = yaml.safeDump(config, {
        styles: {
          '!!null': 'canonical',
        },
        sortKeys: true,
      });
      console.log(newConfig);

      // TODO: check for create file first if none is there
      const result = await github.repos.updateFile({
        ...getContext(account),
        message: 'meta: Update config',
        content: new Buffer(newConfig).toString('base64'),
        sha: configFileSha,
      });
      console.log(result);
    } catch (err) {
      console.error(err);
      // TODO: log error to sentry here
    }
  },
};
