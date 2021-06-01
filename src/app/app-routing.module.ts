import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {OptionsComponent} from './components/options/options.component';
import {HomeComponent} from './components/home/home.component';
import {Guard} from './services/guard.service';
import {BackgroundServiceComponent} from './components/background-service/background-service.component';

const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
    canActivate: [Guard]
  },
  {
    path: 'options',
    component: OptionsComponent
  },
  {
    path: 'background',
    component: BackgroundServiceComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {
    useHash: true
  })],
  exports: [RouterModule]
})
export class AppRoutingModule {
}
