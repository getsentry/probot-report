const _ = require('lodash');
const moment = require('moment');
const NodeMailer = require('nodemailer');
const sendgridTransport = require('nodemailer-sendgrid-transport');
const { shouldPerform } = require('./utils');

/**
 * Tries to create a mailer if a token is passed
 *
 * @param {String} token A token for the mail service
 * @returns {object} The mailer or null
 */
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

/**
 * The singleton mailer instance
 */
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

/**
 * Sends an email via the mailer
 *
 * If no mailer is available (due to authentication errors or a missing token)
 * no email is sent. In dry run the email data is logged but not actually sent
 * out via the transport.
 *
 * Mail data must contain a sender ("from"), recipient ("to"), subject and
 * body ("html"). All additional data is disregarded.
 *
 * @param {object} data Mail data to send
 * @returns {Promise} A promise that resolves after the mail has been sent
 */
function sendMail(data) {
  if (mailer && shouldPerform()) {
    return new Promise((resolve, reject) => {
      mailer.sendMail(data, e => (e ? reject(e) : resolve()));
    });
  }

  return Promise.resolve();
}

/**
 * A configurable e-mail service
 */
module.exports = class Mailer {
  /**
   * Creates a new mailer
   *
   * @param {object} config A mailer configuration object
   */
  constructor(config) {
    this.config = config;
    this.templates = this.compileTemplates();
  }

  /**
   * Compiles all "Template" keys into template functions
   *
   * The resulting object only contains all template keys mapped to a function
   * that accepts parameters and returns a formatted string containing the
   * passed parameters. See lodash's template function for more information.
   *
   * @private
   * @returns {object} The compiled templates
   */
  compileTemplates() {
    const templates = _.pickBy(this.config, (i, key) => /Template$/.test(key));
    return _.mapValues(templates, compile);
  }

  /**
   * Sends a report mail with the given pull requests to the specified user
   *
   * The email will be formatted to the "bodyTemplate" configuration parameter.
   * User and pull requests are interpolated directly into that template.
   *
   * @param {object} user A user object
   * @param {object[]} pullRequests A list of pull requests
   */
  async send(user, pullRequests) {
    if (user.email == null) {
      return;
    }

    const from = this.config.sender;
    const to = `"${user.login}" <${user.email}>`;
    const subject = this.templates.subjectTemplate({ count: pullRequests.length });
    const html = this.templates.bodyTemplate({ user, pullRequests });
    await sendMail({ from, to, subject, html });
  }
};
