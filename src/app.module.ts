import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FirebaseModule } from './firebase/firebase.module';
import { BusModule } from './bus/bus.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    FirebaseModule,
    AuthModule,
    BusModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
