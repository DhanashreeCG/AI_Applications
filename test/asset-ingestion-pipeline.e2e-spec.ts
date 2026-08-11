import request from 'supertest';
import { AssetState, JobState } from '../src/common/enums/asset-state.enum';
import { PipelineTestHarness } from './support/pipeline-test-harness';
import {
  TEST_DRIVE_FOLDER_ID,
  TEST_SEARCH_QUERY,
  TEST_VISION_ANALYSIS,
} from './support/fixtures/pipeline-data.fixture';

describe('Asset Ingestion Pipeline (e2e)', () => {
  const harness = new PipelineTestHarness();
  let completedAssetId = '';

  beforeAll(async () => {
    await harness.init();
    await harness.runFullPipeline();
    const completedAssets = [...harness.db.assets.values()].filter(
      (asset) => asset.status === AssetState.COMPLETED,
    );
    completedAssetId = completedAssets[0]?.id as string;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('creates ingestion jobs through the HTTP API', async () => {
    const createResponse = await request(harness.getHttpServer())
      .post('/asset-ingestion/jobs')
      .send({
        sourceType: 'GOOGLE_DRIVE',
        rootFolderId: TEST_DRIVE_FOLDER_ID,
      })
      .expect(201);

    expect(createResponse.body.jobId).toEqual(expect.any(String));
    expect(createResponse.body.status).toBe(JobState.CREATED);
  });

  it('runs Drive discovery through search and returns the ingested asset', async () => {
    expect(completedAssetId).toBeTruthy();

    const jobs = await request(harness.getHttpServer())
      .get('/asset-ingestion/jobs')
      .expect(200);

    expect(jobs.body.length).toBeGreaterThanOrEqual(1);

    const metadata = harness.db.findAssetMetadataByAssetId(completedAssetId);

    expect(metadata?.searchDescription).toBe(
      TEST_VISION_ANALYSIS.searchDescription,
    );
    expect(harness.db.assetEmbeddings.size).toBeGreaterThanOrEqual(1);
    expect(harness.mockSqs.peekQueue('dlq')).toHaveLength(0);

    const searchResponse = await request(harness.getHttpServer())
      .post('/search')
      .send({
        query: TEST_SEARCH_QUERY,
        limit: 5,
        bypassCache: true,
      })
      .expect(200);

    expect(searchResponse.body.total).toBeGreaterThanOrEqual(1);
    expect(searchResponse.body.results[0].assetId).toBe(completedAssetId);
    expect(searchResponse.body.results[0].caption).toBe(
      TEST_VISION_ANALYSIS.metadata.caption,
    );
    expect(searchResponse.body.results[0].similarity).toBeGreaterThan(0.4);
  });

  it('exposes pipeline metrics after processing', async () => {
    const metricsResponse = await request(harness.getHttpServer())
      .get('/observability/metrics')
      .expect(200);

    expect(metricsResponse.body.imagesDiscovered).toBeGreaterThanOrEqual(1);
    expect(metricsResponse.body.imagesSuccessful).toBeGreaterThanOrEqual(1);
    expect(metricsResponse.body.imagesProcessed).toBeGreaterThanOrEqual(1);
  });

  it('caches search responses and flushes cache on demand', async () => {
    const firstSearch = await request(harness.getHttpServer())
      .post('/search')
      .send({
        query: TEST_SEARCH_QUERY,
        limit: 3,
      })
      .expect(200);

    expect(firstSearch.body.fromCache).toBeUndefined();

    const cachedSearch = await request(harness.getHttpServer())
      .post('/search')
      .send({
        query: TEST_SEARCH_QUERY,
        limit: 3,
      })
      .expect(200);

    expect(cachedSearch.body.fromCache).toBe(true);

    await request(harness.getHttpServer())
      .post('/search/cache/flush')
      .send({ scope: 'search' })
      .expect(200);

    const afterFlush = await request(harness.getHttpServer())
      .post('/search')
      .send({
        query: TEST_SEARCH_QUERY,
        limit: 3,
      })
      .expect(200);

    expect(afterFlush.body.fromCache).toBeUndefined();
  });
});
