import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateContentRestrictionDto,
  UpdateContentRestrictionDto,
} from './dto/content-restriction.dto';
import { ContentRestrictionService } from './services/content-restriction.service';

@ApiTags('restricted-words')
@Controller('restricted-words')
export class ContentRestrictionController {
  constructor(private readonly restrictions: ContentRestrictionService) {}

  @Get()
  @ApiOperation({ summary: 'List all platform restricted/banned words' })
  list() {
    return this.restrictions.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a content restriction term' })
  create(@Body() dto: CreateContentRestrictionDto) {
    return this.restrictions.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a content restriction term' })
  update(@Param('id') id: string, @Body() dto: UpdateContentRestrictionDto) {
    return this.restrictions.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a content restriction term' })
  remove(@Param('id') id: string) {
    return this.restrictions.remove(id);
  }
}
