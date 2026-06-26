import { Routes } from '@angular/router';
import { NotFoundPageComponent } from './not-found-page.component';
import { PortfolioPageComponent } from './portfolio-page.component';

export const routes: Routes = [
  { path: '', component: PortfolioPageComponent },
  { path: 'costa', component: PortfolioPageComponent },
  { path: 'montana', component: PortfolioPageComponent },
  { path: 'nocturnas', component: PortfolioPageComponent },
  { path: 'ciudad', component: PortfolioPageComponent },
  { path: 'foto/:slug', component: PortfolioPageComponent },
  { path: '404', component: NotFoundPageComponent },
  { path: '**', component: NotFoundPageComponent }
];
