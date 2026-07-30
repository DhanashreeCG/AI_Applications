import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchAssetsDto } from './dto/search-assets.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async searchAssets(@Body() dto: SearchAssetsDto) {
    return this.searchService.search(dto);
  }

  @Post('cache/flush')
  @HttpCode(HttpStatus.OK)
  async flushCache(
    @Body() body?: { scope?: 'search' | 'asset-metadata' | 'all' },
  ) {
    return this.searchService.flushCache(body?.scope ?? 'all');
  }
}
