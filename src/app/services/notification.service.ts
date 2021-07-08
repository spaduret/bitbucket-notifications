import {Injectable} from '@angular/core';
import {DataService} from './data.service';
import {SlackClient, SlackMessageOptions} from './slackClient';
import {catchError} from 'rxjs/operators';
import {of, throwError} from 'rxjs';
import {NotificationOptions, PullRequestIssue} from '../models/models';
import {BitbucketService} from './bitbucket.service';
import {PullRequestActivityAction} from '../models/enums';

@Injectable()
export class NotificationService {

  constructor(private dataService: DataService, private bitbucketService: BitbucketService) {
  }

  private requestPermission(): Promise<NotificationPermission> {
    if (Notification.permission !== 'denied') {
      return Notification.requestPermission();
    }

    return new Promise<NotificationPermission>(() => Notification.permission);
  }

  sendNotification(options: NotificationOptions) {

    // skip notification if it is snoozed for this PR
    let snoozeSettings = this.dataService.getNotificationSnoozeSettings();
    if (snoozeSettings.includes(options.pullRequest.id)) {
      return;
    }

    let extensionSettings = this.dataService.getExtensionSettings();

    if (extensionSettings.notifications.browser) {
      this.requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            let body = '';
            switch (options.action) {
              case PullRequestActivityAction.Commented:
                body = 'comment(s) added';
                break;
              case PullRequestActivityAction.Opened:
                body = 'new pull request created';
                break;
              case PullRequestActivityAction.Approved:
                body = 'pull request approved';
                break;
              case PullRequestActivityAction.Merged:
                body = 'pull request merged';
                break;
              case PullRequestActivityAction.Declined:
                body = 'pull request declined';
                break;
              case PullRequestActivityAction.Removed:
                body = 'pull request removed';
                break;
            }

            new Notification(options.pullRequest.title, {
              icon: 'favicon.ico',
              body: body
            });
          }
        });
    }

    // check if slack is enabled
    if (extensionSettings.notifications.slack) {
      let slackSettings = extensionSettings.notifications.slack;
      let slackClient = new SlackClient(slackSettings.token);

      // todo: pull connected issues from:
      let pr = options.pullRequest;
      this.bitbucketService
        .getPullRequestIssues(pr.fromRef.repository.project.key, pr.fromRef.repository.slug, pr.id)
        .pipe(catchError(() => of([])))
        .subscribe(issues => {
          let messageOptions = NotificationService.buildPullRequestSlackMessage(slackSettings.memberId, options, issues);

          slackClient
            .postMessage(messageOptions)
            .pipe(
              catchError((error: any) => {
                this.setBadge({title: error.error, color: 'red', message: 'slack'});
                return throwError(error);
              }))
            .subscribe((data: any) => {
              if (!data.ok) {
                console.log(data);
                this.setBadge({title: data.error, color: 'red', message: 'slack'});
                throw data.error;
              }
            });
        });
    }
  }

  setBadge(options: { title?: string, message?: string, color?: string }) {
    if (options.message) {
      // @ts-ignore
      chrome.action.setBadgeText({text: options.message});
    }

    if (options.color) {
      // @ts-ignore
      chrome.action.setBadgeBackgroundColor({color: options.color});
    }

    if (options.title) {
      // @ts-ignore
      chrome.action.setTitle({title: options.title});
    }
  }

  public static buildPullRequestSlackMessage(memberId: string, options: NotificationOptions, issues: PullRequestIssue[]): SlackMessageOptions {
    let title: string;
    let data = options.pullRequest;

    // todo: move :reaction: names to settings
    switch (options.action) {
      case PullRequestActivityAction.Commented:
        title = `:memo: @${options.comment?.author.name} added new comment`;
        break;
      case PullRequestActivityAction.Opened:
        title = `:pull_request: @${options.pullRequest.author.user.name} assigned a new pull request`;
        break;
      case PullRequestActivityAction.Approved:
        title = ':white_check_mark: Your pull request approved';
        break;
      case PullRequestActivityAction.Merged:
        title = `:merged: @${options.activity?.user.name} merged pull request`;
        break;
      case PullRequestActivityAction.Declined:
        title = `:heavy_multiplication_x: @${options.activity?.user.name} declined pull request`;
        break;
      case PullRequestActivityAction.Removed:
        title = `:x: pull request was removed`;
        break;
      default:
        title = `something happened with pull request: ${options.action}`;
        break;
    }

    let message: SlackMessageOptions = {
      channel: memberId,
      text: title,
      blocks: []
    };

    // add title
    message.blocks?.push({
      'type': 'section',
      'text': {
        'type': 'mrkdwn',
        'text': `${title}: *<${data.links.self[0].href}|${data.title}>*`
      }
    });

    // add comment
    if (options.action == PullRequestActivityAction.Commented) {
      message.blocks?.push({
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': `_${options.comment?.text}_`
        }
      });
    }

    // add description
    if (data.description?.length) {
      let prDescription: string;
      if (options.action === PullRequestActivityAction.Opened) {
        // use full description for just created PR
        prDescription = data.description;
      } else {
        let spaceIndex = data.description.indexOf(' ', 50);
        prDescription = data.description.length > 50 && spaceIndex > 50
          ? (data.description.substr(0, spaceIndex + 1)) + '...'
          : data.description;
      }

      message.blocks?.push({
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': `*Description:*\n${prDescription}\n`
        }
      });
    }

    // add issues
    if (issues.length) {
      message.blocks?.push({
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': `*Issues:* ${issues.map(i => `<${i.url}|${i.key}>`).join(', ')}`
        }
      });
    }

    // add context
    message.blocks?.push({
      'type': 'context',
      'elements': [
        {
          'text':
            `*PR created by <${data.author.user.links?.self[0].href}|${data.author.user.displayName}>` +
            ` at ${new Date(data.createdDate).toDateString()}*` +
            ` | <${data.fromRef.repository.links?.self[0].href}|${data.fromRef.repository.name}>` +
            ` \`${data.toRef.displayId}\`` +
            `${data.properties.commentCount ? (` :memo:${data.properties.commentCount}`) : ''}`,
          'type': 'mrkdwn'
        }
      ]
    });

    message.blocks?.push({'type': 'divider'});
    return message;
  }
}
