import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, JwtGuard],
  exports: [UsersService],
})
export class UsersModule {}
