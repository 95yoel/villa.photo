import { Routes } from '@angular/router';
import { PortfolioPageComponent } from './portfolio-page.component';

export const routes: Routes = [
  { path: '', component: PortfolioPageComponent },
  { path: 'foto/:slug', component: PortfolioPageComponent },
  { path: '**', redirectTo: '' }
];
