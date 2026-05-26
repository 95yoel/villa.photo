import { Routes } from '@angular/router';
import { NotFoundPageComponent } from './not-found-page.component';
import { PortfolioPageComponent } from './portfolio-page.component';

export const routes: Routes = [
  { path: '', component: PortfolioPageComponent },
  { path: 'foto/:slug', component: PortfolioPageComponent },
  { path: '404', component: NotFoundPageComponent },
  { path: '**', component: NotFoundPageComponent }
];
