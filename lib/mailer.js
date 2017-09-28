const _ = require('lodash');
const moment = require('moment');
const NodeMailer = require('nodemailer');
const sendgridTransport = require('nodemailer-sendgrid-transport');
const { shouldPerform } = require('./utils');

/**
 * The singleton mailer instance
 */
let mailer = null;

/**
 * Tries to create a singleton mailer instance
 *
 * @param {object} logger A logger instance
 * @returns {object} The mailer or null
 */
function getMailer(logger = console) {
  if (mailer != null) {
    return mailer;
  }

  const token = process.env.SENDGRID_TOKEN;
  if (!token) {
    logger.error('Could not configure mailer: Token missing');
    return null;
  }

  try {
    // TODO: Allow for other transports than sendgrid
    logger.info('Initializing Sendgrid mailer');
    mailer = NodeMailer.createTransport(sendgridTransport({
      auth: { api_key: token },
    }));
    return mailer;
  } catch (e) {
    logger.error('Could not initialize Sendgrid', e);
    mailer = false;
    return mailer;
  }
}

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
 * A configurable e-mail service
 */
module.exports = class Mailer {
  /**
   * Creates a new mailer
   *
   * @param {object} config A mailer configuration object
   */
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.templates = this.compileTemplates();
    this.internal = getMailer(logger);
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
    const templates = _.pickBy(this.config.get().email, (i, key) => /Template$/.test(key));
    return _.mapValues(templates, compile);
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
  sendMail(data) {
    this.logger.debug('Sending email', data);

    if (this.internal && shouldPerform()) {
      return new Promise((resolve, reject) => {
        this.internal.sendMail(data, e => (e ? reject(e) : resolve()));
      });
    }

    this.logger.debug('Skipping email, no mailer configured');
    return Promise.resolve();
  }

  /**
   * Formats a list of issues with the default issue template and wraps them in
   * the given template. If the issues are empty, an empty string is returned.
   *
   * This method also checks for the presence of required template functions. If
   * absent, an error is logged, but still an empty string returned.
   *
   * @param {Function} template A template to wrap issues with
   * @param {object[]} issues   The list of issue to format
   */
  formatIssues(template, issues) {
    const { issueTemplate } = this.templates;
    if (!template || !this.templates) {
      this.logger.error('Could not format issues, templates missing');
      return '';
    }

    if (issues.length === 0) {
      return '';
    }

    return template({ issues: issueTemplate({ issues }) });
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
  async sendReport(report) {
    const user = report.getUser();
    if (user.email == null) {
      this.logger.error(`Cannot send email to ${user.login}: No email found`);
      return;
    }

    const from = this.config.get().email.sender;
    const to = `"${user.name}" <${user.email}>`;
    const subject = this.templates.subjectTemplate({ count: report.count() });

    const html = this.templates.bodyTemplate({
      user,
      toReview: this.formatIssues(this.templates.toReviewTemplate,
        report.getPullRequestsToReview()),
      toComplete: this.formatIssues(this.templates.toCompleteTemplate,
        report.getPullRequestsToComplete()),
      newIssues: this.formatIssues(this.templates.newIssuesTemplate,
        report.getNewIssues()),
    });

    await this.sendMail({ from, to, subject, html });
  }
};
