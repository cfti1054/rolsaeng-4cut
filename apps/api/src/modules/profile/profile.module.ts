import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GameAccountsModule } from '../game-accounts/game-accounts.module';
import { RatingsModule } from '../ratings/ratings.module';
import { ProfileController } from './profile.controller';
import { ProfileScrimService } from './profile-scrim.service';
import { ProfileService } from './profile.service';

@Module({
  imports: [GameAccountsModule, RatingsModule],
  controllers: [ProfileController],
  providers: [ProfileService, ProfileScrimService, JwtGuard],
})
export class ProfileModule {}
