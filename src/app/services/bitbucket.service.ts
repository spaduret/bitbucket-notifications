import {inject, Injectable} from '@angular/core';
import {BitbucketResponse, BitbucketUser, PullRequest, PullRequestActivity, PullRequestIssue} from '../models/models';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {DataService} from './data.service';
import {PullRequestRole, PullRequestState} from '../models/enums';
import {map} from 'rxjs/operators';

@Injectable()
export class BitbucketService {
  private http = inject(HttpClient);
  private dataService = inject(DataService);

  private get settings() {
    return this.dataService.getExtensionSettings();
  }

  private get headers() {
    return {'Authorization': `Bearer + ${this.settings.bitbucket?.token}`};
  }

  validateCredentials(url?: string, token?: string, userSlug?: string): Observable<BitbucketUser> {
    return this.http.get(
      `${url}/rest/api/latest/users/${userSlug}`,
      {headers: {'Authorization': `Bearer + ${token}`}})
      .pipe(
        map((data) => data as BitbucketUser)
      );
  }

  getPullRequests(role: PullRequestRole): Observable<BitbucketResponse<PullRequest>> {
    // normally participant shouldn't be assigned to more than 50 PRs
    // todo: https://bitbucket.teamvelocityonline.com/rest/api/latest/dashboard/pull-requests?limit=50&state=OPEN
    return this.http.get(
      `${this.settings.bitbucket?.url}/rest/api/latest/inbox/pull-requests?role=${role}&limit=50`,
      {headers: this.headers})
      .pipe(
        map((data) => data as BitbucketResponse<PullRequest>)
      );
  }

  getAllPullRequests(state?: PullRequestState): Observable<BitbucketResponse<PullRequest>> {
    return this.http.get(
      `${this.settings.bitbucket?.url}/rest/api/latest/dashboard/pull-requests?state=${state}&limit=100`,
      {headers: this.headers})
      .pipe(
        map((data) => data as BitbucketResponse<PullRequest>)
      );
  }

  getPullRequestActivities(projectKey: string, repositorySlug: string, pullRequestId: number)
    : Observable<BitbucketResponse<PullRequestActivity>> {
    return this.http
      .get(
        `${this.settings.bitbucket?.url}/rest/api/latest/projects/${projectKey}/repos/${repositorySlug}/pull-requests/${pullRequestId}/activities?limit=100`,
        {headers: this.headers}
      )
      .pipe(map(data => data as BitbucketResponse<PullRequestActivity>));
  }

  getPullRequestIssues(projectKey: string, repositorySlug: string, pullRequestId: number)
    : Observable<PullRequestIssue[]> {
    return this.http
      .get(
        `${this.settings.bitbucket?.url}/rest/jira/latest/projects/${projectKey}/repos/${repositorySlug}/pull-requests/${pullRequestId}/issues?limit=100`,
        {headers: this.headers}
      ).pipe(map(data => data as PullRequestIssue[]));
  }
}


