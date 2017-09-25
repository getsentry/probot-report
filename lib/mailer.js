const _ = require('lodash');
const moment = require('moment');
const NodeMailer = require('nodemailer');
const sendgridTransport = require('nodemailer-sendgrid-transport');
const { shouldPerform } = require('./utils');

function createMailer(token) {
  if (!token) {
    // TODO: Log something
    return null;
  }

  try {
    // TODO: Allow for other transports than sendgrid
    return NodeMailer.createTransport(sendgridTransport({
      auth: { api_key: token },
    }));
  } catch (e) {
    // TODO: Log error to Sentry
    console.error('Could not initialize Sendgrid', e);
    return null;
  }
}

const mailer = createMailer(process.env.SENDGRID_TOKEN);

/**
 * Compiles the given template string
 *
 * Creates a compiled template function that can interpolate data properties
 * in "interpolate" delimiters, HTML-escape interpolated data properties in
 * "escape" delimiters, and execute JavaScript in "evaluate" delimiters. Data
 * properties may be accessed as free variables in the template.
 *
 * @param {string} string
 */
function compile(string) {
  return _.template(string, { imports: { moment } });
}

function sendMail(data, callback) {
  if (mailer && shouldPerform()) {
    mailer.sendMail(data, callback);
  } else {
    callback();
  }
}

module.exports = class Mailer {
  constructor(config) {
    this.config = config;
    this.templates = this.compileTemplates();
  }

  compileTemplates() {
    const templates = _.pickBy(this.config, key => /Template$/.test(key));
    return _.mapValues(templates, compile);
  }

  formatPullRequest(pr) {
    const repo = pr.repository_url.match('[^/]+/[^/]+$')[0];
    return this.templates.itemTemplate({ repo, pr });
  }

  async send(user, pullRequests) {
    if (user.email == null) {
      return;
    }

    const items = pullRequests.map(pr => this.formatPullRequest(pr)).join('\n');
    const message = this.templates.messageTemplate({ user, items });
    const recipient = `"${user.login}" <${user.email}>`;
    const subject = this.templates.subjectTemplate({ count: pullRequests.length });

    const email = { from: this.config.sender, to: recipient, subject, html: message };
    await new Promise((resolve, reject) => sendMail(email, e => e && reject(e)));
  }
};
