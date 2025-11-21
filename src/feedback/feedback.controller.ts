import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Param,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async submitFeedback(
    @Body() feedbackData: { message: string; rating?: number },
    @Req() req: Request,
  ) {
    const authenticatedUser = req.user as { userId: string; email: string };
    return await this.feedbackService.submitFeedback(
      authenticatedUser.userId,
      feedbackData,
    );
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserFeedback(@Param('userId') userId: string) {
    return await this.feedbackService.getUserFeedback(userId);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard)
  async getAllFeedback() {
    return await this.feedbackService.getAllFeedback();
  }

  @Post(':feedbackId/response')
  @UseGuards(JwtAuthGuard)
  async respondToFeedback(
    @Param('feedbackId') feedbackId: string,
    @Body() responseData: { response: string },
    @Req() req: Request,
  ) {
    const authenticatedUser = req.user as { userId: string; email: string };
    return await this.feedbackService.respondToFeedback(
      feedbackId,
      authenticatedUser.userId,
      responseData.response,
    );
  }
}