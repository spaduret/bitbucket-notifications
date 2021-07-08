import {EventEmitter, Injectable} from '@angular/core';
import {BitbucketService} from './bitbucket.service';
import {BitbucketCommentAction, PullRequestActivityAction, PullRequestRole, PullRequestState} from '../models/enums';
import {ExtensionSettings, PullRequest} from '../models/models';
import {DataService} from './data.service';
import {NotificationService} from './notification.service';
import {catchError} from 'rxjs/operators';
import {of, throwError} from 'rxjs';
import Alarm = chrome.alarms.Alarm;
import {HttpErrorResponse} from '@angular/common/http';

// @ts-ignore
let chr: any = chrome;

@Injectable()
export class BackgroundService {
  interval: number;
  public dataProcessed!: EventEmitter<PullRequestRole>;
  private settings!: ExtensionSettings;
  private lastRunningTime!: number;

  constructor(
    private dataService: DataService,
    private bitbucketService: BitbucketService,
    private notificationService: NotificationService) {
    this.dataProcessed = new EventEmitter<PullRequestRole>(true);
    const settings = this.dataService.getExtensionSettings();
    this.interval = settings.refreshIntervalInMinutes;
  }

  setupAlarms() {
    chr.alarms.clearAll((wasCleared: boolean) => {
      if (wasCleared) {
        console.debug('alarms cleared');
      }

      if (chr.alarms.onAlarm.hasListeners()) {
        console.error('alarm listener is already defined');
        this.showError('alarm listener is already defined');
      } else {
        chr.alarms.create({periodInMinutes: 1});
        console.debug('alarm created');

        this.addAlarmListener();

        if (chr.alarms.onAlarm.hasListeners()) {
          console.debug('alarm listener has been added');
        } else {
          console.error('alarm listener was not added');
          this.showError('alarm listener was not added');
        }
      }
    });
  }

  private addAlarmListener() {
    chr.alarms.onAlarm.addListener((alarm: Alarm) => {
      this.doWork();

      const settings = this.dataService.getExtensionSettings();
      const newInterval = settings.refreshIntervalInMinutes;
      if (settings.refreshIntervalInMinutes !== alarm.periodInMinutes) {
        console.log(`interval changed from ${alarm.periodInMinutes} to ${newInterval}, restarting alarm...`);

        chr.alarms.create({periodInMinutes: settings.refreshIntervalInMinutes});
        console.debug('alarm created');
      }
    });
  }

  private showError(message: string) {
    chr.action.setBadgeBackgroundColor({color: 'red'});
    chr.action.setBadgeText({text: message});
  }

  doWork() {
    let runningTime = Date.now();
    this.settings = this.dataService.getExtensionSettings();
    this.lastRunningTime = this.dataService.getLastRunningTimestamp();
    if (!this.settings.bitbucket?.isValid()) {
      console.log('setup bitbucket settings first...');
      this.notificationService.setBadge({message: '404', color: 'red', title: 'missing settings'});
      return;
    }

    this.notificationService.setBadge({message: '...', title: 'loading...', color: 'gray'});
    const processingTime = new Date();
    this.bitbucketService
      .getAllPullRequests(PullRequestState.Open)
      .subscribe(data => {
        const created = data.values.filter(v => v.author.user.name === this.settings.bitbucket?.username);
        const reviewing = data.values.filter(v => v.reviewers.some(r => r.user.name === this.settings.bitbucket?.username));
        const participant = data.values.filter(v => v.participants.some(r => r.user.name === this.settings.bitbucket?.username));

        this.handleResponse(PullRequestRole.Author, created);
        this.handleResponse(PullRequestRole.Reviewer, reviewing);
        this.handleResponse(PullRequestRole.Participant, participant);

        this.notificationService.setBadge({
          message: `${created.length + reviewing.length + participant.length}`,
          color: 'green',
          title: `created: ${created.length}\nreviewing: ${reviewing.length}\nparticipant: ${participant.length}\nlast update at ${processingTime.toLocaleTimeString()}`
        });

        this.dataService.saveLastRunningTimestamp(runningTime);
        this.dataProcessed.emit();
      });
  }

  /*
  Rules:
    + New PR for review was added
    - Created PR was Approved
    + Comment added to a created / reviewing / participating PR (todo: check only for mentions)
    - Code conflict detected in the created / reviewing PR
    - Code conflict fixed in the created / reviewing PR
    - Created / reviewing PR was declined / removed
    - Created PR was merged
   */

  handleResponse(role: PullRequestRole, values: PullRequest[]) {
    const before = this.dataService.getPullRequests(role);

    // todo: store notified PRs somewhere to avoid spamming

    this.reviewCommentsCount(before, values);
    switch (role) {
      case PullRequestRole.Author:
        this.reviewPullRequestApprovals(before, values);
        this.reviewMissingPullRequests(before, values);
        break;
      case PullRequestRole.Reviewer:
        // todo: check if code conflicts were fixed
        this.reviewNewPullRequests(before, values);
        this.reviewMissingPullRequests(before, values);
        break;
      case PullRequestRole.Participant:
        //this.reviewNewPullRequests(before, values);
        break;
    }

    this.dataService.savePullRequests(role, values);
  }

  // run for pull requests with any role
  reviewCommentsCount(before: PullRequest[], now: PullRequest[]) {
    now
      .filter(n => before.some(b => b.id === n.id && b.properties.commentCount !== n.properties.commentCount))
      .forEach(n => {
        this.bitbucketService
          .getPullRequestActivities(n.fromRef.repository.project.key, n.fromRef.repository.slug, n.id)
          .subscribe(data => {
            let comments = data.values.filter(a =>
              a.action === PullRequestActivityAction.Commented
              // check if it's a new comment
              && a.commentAction === BitbucketCommentAction.Added
              // make sure it's not my comment
              && (
                a.comment?.author.id !== this.settings?.bitbucket?.userId
                // check for first-level replies, todo: add recursion to go deeper
                || a.comment?.comments?.some(cc =>
                  cc.updatedDate >= this.lastRunningTime
                  && cc.author.id !== this.settings?.bitbucket?.userId)
              )
              // check if action occurred after last running time
              && a.createdDate >= this.lastRunningTime
            );

            if (comments.length > 0) {
              this.notificationService.sendNotification(
                {
                  action: PullRequestActivityAction.Commented,
                  pullRequest: n,
                  comment: comments[0].comment
                });
            }
          });
      });
  }

  // run only for REVIEWING or PARTICIPANT role
  reviewNewPullRequests(before: PullRequest[], now: PullRequest[]) {
    now
      .filter(b => !before.some(n => n.id === b.id))
      .forEach(n => {
        this.bitbucketService
          .getPullRequestActivities(n.fromRef.repository.project.key, n.fromRef.repository.slug, n.id)
          .subscribe(data => {
            let isTrueReviewer = data.values.some(a =>
              a.action === PullRequestActivityAction.Updated
              // check if action occurred after last running time
              && a.createdDate >= this.lastRunningTime
              // make sure activity wasn't generated by myself
              && a.user.id !== this.settings?.bitbucket?.userId
              // get activities where I was added as a reviewer
              && a.addedReviewers?.some(r => r.id === this.settings?.bitbucket?.userId));

            if (isTrueReviewer) {
              this.notificationService.sendNotification(
                {
                  action: PullRequestActivityAction.Opened,
                  pullRequest: n
                });
            }
          });
      });
  }

  reviewMissingPullRequests(before: PullRequest[], now: PullRequest[]) {
    before
      .filter(b => !now.some(n => n.id === b.id))
      .forEach(b => {
        this.bitbucketService
          .getPullRequestActivities(b.fromRef.repository.project.key, b.fromRef.repository.slug, b.id)
          .pipe(catchError(error => {
            if (error instanceof HttpErrorResponse && error.status === 404) {
              this.notificationService.sendNotification(
                {
                  action: PullRequestActivityAction.Removed,
                  pullRequest: b
                });

              return of({values: []});
            } else {
              return throwError(error);
            }
          }))
          .subscribe(data => {
            let activities = data.values.filter(a =>
              (a.action === PullRequestActivityAction.Merged || a.action === PullRequestActivityAction.Declined)
              // make sure activity wasn't generated by myself
              && a.user.id !== this.settings?.bitbucket?.userId
              // check if action occurred after last running time
              && a.createdDate >= this.lastRunningTime);

            if (activities.length) {
              // get recent activity
              let act = activities.sort((one, two) => (one.createdDate > two.createdDate ? -1 : 1))[0];
              this.notificationService.sendNotification(
                {
                  action: act.action,
                  pullRequest: b,
                  activity: act
                });
            }
          });
      });
  }

  reviewPullRequestApprovals(before: PullRequest[], now: PullRequest[]) {
    now
      .filter(n => before.some(b =>
        b.id === n.id
        // before nobody approved this pr
        && !b.reviewers.some(r => r.approved)
        // now somebody approved this pr
        && n.reviewers.some(r => r.approved)))
      .forEach(n => {
        this.notificationService.sendNotification(
          {
            action: PullRequestActivityAction.Approved,
            pullRequest: n
          });
      });
  }
}
