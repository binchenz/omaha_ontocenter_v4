import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UPLOAD_DIR } from './sdk/import-engine.service';
import * as path from 'path';

const MAX_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FileController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        cb(new BadRequestException(`不支持的文件格式: ${ext}。支持: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
        return;
      }
      cb(null, true);
    },
  }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('请上传文件');
    return {
      fileId: file.filename,
      filename: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }
}
