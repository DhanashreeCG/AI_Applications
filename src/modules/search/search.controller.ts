import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchAssetsDto } from './dto/search-assets.dto';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Semantic search assets' })
  async searchAssets(@Body() dto: SearchAssetsDto) {
    return this.searchService.search(dto);
  }

  @Post('cache/flush')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flush search / metadata cache' })
  async flushCache(
    @Body() body?: { scope?: 'search' | 'asset-metadata' | 'all' },
  ) {
    return this.searchService.flushCache(body?.scope ?? 'all');
  }
}
