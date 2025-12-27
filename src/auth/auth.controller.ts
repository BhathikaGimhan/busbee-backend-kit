import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseInterceptors(
    FilesInterceptor('photos', 5, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/bus-photos';
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
           cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async register(
    @Body('data') data: string,
    @UploadedFiles() photos: Array<Express.Multer.File>,
  ) {
    let registerDto: RegisterDto;
    try {
        registerDto = JSON.parse(data);
    } catch (e) {
        throw new BadRequestException('Invalid data format. Expected JSON string in "data" field');
    }

    if (photos && photos.length > 0) {
        if (!registerDto.busDetails) {
            registerDto.busDetails = {} as any;
        }
        registerDto.busDetails.photos = photos.map(file => `/uploads/bus-photos/${file.filename}`);
    }

    console.log('🎯 Register endpoint hit with data:', registerDto);
    return this.authService.register(registerDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    return this.authService.validateUser(req.user.userId);
  }
}
