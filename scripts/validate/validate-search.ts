import { SearchService } from '../../src/modules/search/search.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const query = parseArg('query');
  if (!query) {
    throw new Error('Missing required argument: --query <SEARCH_TEXT>');
  }

  const limit = parseInt(parseArg('limit') ?? '5', 10);
  const searchService = app.get(SearchService);

  return searchService.search({
    query,
    limit,
    bypassCache: true,
  });
});
