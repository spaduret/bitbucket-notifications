import {BitbucketSettings, ExtensionSettings, SlackSettings} from '../../models/models';
import {DataService} from '../../services/data.service';
import {BitbucketService} from '../../services/bitbucket.service';
import {forkJoin, of, throwError} from 'rxjs';
import {catchError, tap} from 'rxjs/operators';
import {Component, OnInit} from '@angular/core';
import {SlackClient} from '../../services/slackClient';
import {BackgroundService} from '../../services/background.service';

@Component({
  selector: 'app-options',
  templateUrl: './options.component.html',
  styleUrls: ['./options.component.scss']
})
export class OptionsComponent implements OnInit {

  settings: ExtensionSettings;
  statusMessage?: string;
  errorMessage?: string;

  enableSlackNotifications: boolean;
  slackSettings: SlackSettings;
  bitbucketSettings: BitbucketSettings;

  constructor(
    private settingsService: DataService,
    private bitbucketService: BitbucketService,
    private backgroundService: BackgroundService) {
    this.settings = settingsService.getExtensionSettings();

    this.enableSlackNotifications = !!this.settings.notifications.slack;
    this.slackSettings = this.settings.notifications.slack || new SlackSettings();
    this.bitbucketSettings = this.settings.bitbucket || new BitbucketSettings();
  }

  ngOnInit(): void {
  }

  onSave() {
    this.statusMessage = 'saving...';
    const bitbucketPromise = this.bitbucketService
      .validateCredentials(this.bitbucketSettings.url, this.bitbucketSettings.token, this.bitbucketSettings.username)
      .pipe(catchError((error, _) => {
        this.showError('wrong bitbucket credentials');
        return throwError(error);
      }));

    let slackClient = new SlackClient();
    const slackPromise = this.enableSlackNotifications
      ? slackClient
        .testAuth(this.slackSettings.token)
        .pipe(
          tap((data: any) => {
            if (!data.ok) {
              this.showError('wrong slack credentials');
              throw 'wrong slack credentials';
            }
          }),
          catchError((error, _) => {
            this.showError('wrong slack credentials');
            return throwError(error);
          })
        )
      : of(null);

    forkJoin([bitbucketPromise, slackPromise])
      .subscribe(_ => {
        this.settings.bitbucket = this.bitbucketSettings;
        this.settings.bitbucket.userId = _[0].id;

        this.settings.notifications.slack = this.enableSlackNotifications
          ? this.slackSettings
          : undefined;
        this.settingsService.saveExtensionSettings(this.settings);

        if (navigator && navigator.serviceWorker) {
          navigator.serviceWorker.controller?.postMessage({
            type: 'settings-saved',
            settings: this.settings
          });
        }

        // fetch data
        this.backgroundService.doWork();

        this.showMessage('saved!');
      });
  }

  onSlackTest() {
    let slackClient = new SlackClient(this.slackSettings.token);
    slackClient
      .postMessage({
        'channel': this.slackSettings.memberId,
        'text': 'hello'
      })
      .subscribe((data: any) => {
        if (!data.ok) {
          this.showError(data.error || 'wrong slack credentials');
        } else {
          this.showMessage('message sent');
        }
      });
  }

  showMessage(message: string) {
    this.statusMessage = message;
    setTimeout(() => {
      this.statusMessage = undefined;
    }, 2000);
  }

  showError(error: string) {
    this.errorMessage = error;
    setTimeout(() => {
      this.errorMessage = undefined;
    }, 5000);
  }
}

