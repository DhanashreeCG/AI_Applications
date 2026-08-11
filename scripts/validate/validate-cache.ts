import { SearchService } from '../../src/modules/search/search.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const query = parseArg('query') ?? 'orange cat on windowsill';
  const searchService = app.get(SearchService);

  const first = await searchService.search({ query, limit: 3 });
  const second = await searchService.search({ query, limit: 3 });
  const flushed = await searchService.flushCache('search');
  const third = await searchService.search({ query, limit: 3 });

  return {
    firstFromCache: first.fromCache ?? false,
    secondFromCache: second.fromCache ?? false,
    flushed,
    thirdFromCache: third.fromCache ?? false,
  };
});
