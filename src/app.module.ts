import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FirebaseModule } from './firebase/firebase.module';
import { BusModule } from './bus/bus.module';
import { FeedbackModule } from './feedback/feedback.module';
import { InquiryModule } from './inquiry/inquiry.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    FirebaseModule,
    AuthModule,
    BusModule,
    FeedbackModule,
    InquiryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
