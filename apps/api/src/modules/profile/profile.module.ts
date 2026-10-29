import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GameAccountsModule } from '../game-accounts/game-accounts.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [GameAccountsModule],
  controllers: [ProfileController],
  providers: [ProfileService, JwtGuard],
})
export class ProfileModule {}
