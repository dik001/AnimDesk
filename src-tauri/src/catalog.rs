use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::VecDeque, time::Duration};
use tokio::{
    sync::Mutex,
    time::{sleep, Instant},
};

const SHIKIMORI_ENDPOINT: &str = "https://shikimori.io/api/graphql";

const SOURCE_DEADLINE: Duration = Duration::from_secs(12);

const LIST_FIELDS: &str = "id malId name russian english japanese poster { mainUrl } score kind episodes airedOn { year }";
const DETAIL_FIELDS: &str = "id malId name russian english japanese synonyms description poster { mainUrl } genres { name russian } score kind episodes status airedOn { year } related { relationText anime { id name russian poster { mainUrl } kind airedOn { year } } }";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogRequest {
    provider: String,
    operation: String,
    query: Option<String>,
    id: Option<String>,
    page: Option<u32>,
    year: Option<u32>,
    kind: Option<String>,
    season: Option<String>,
    genre: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogError {
    code: &'static str,
    message: String,
    detail: String,
    retry_after_seconds: Option<u64>,
}
fn error(code: &'static str, detail: impl ToString) -> CatalogError {
    CatalogError {
        code,
        message: match code {
            "timeout" => "Источник не ответил вовремя.",
            "network" => "Нет связи с источником. Проверьте подключение к сети.",
            "rate_limit" => "Источник ограничил запросы. Повторите позже.",
            "service_discontinued" => "Источник метаданных недоступен.",
            "validation" => "Некорректный запрос каталога.",
            _ => "Источник вернул ошибку или некорректные данные.",
        }
        .into(),
        detail: detail.to_string(),
        retry_after_seconds: None,
    }
}

#[derive(Default)]
struct Queue {
    starts: VecDeque<Instant>,
    blocked_until: Option<Instant>,
    blocked_permanently: bool,
}
impl Queue {
    async fn acquire(&mut self) {
        loop {
            let now = Instant::now();
            while self
                .starts
                .front()
                .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
            {
                self.starts.pop_front();
            }
            let mut ready = now;
            if let Some(last) = self.starts.back() {
                ready = ready.max(*last + Duration::from_secs(1));
            }
            if self.starts.len() >= 45 {
                ready = ready.max(self.starts[0] + Duration::from_secs(60));
            }
            if let Some(blocked) = self.blocked_until {
                ready = ready.max(blocked);
            }
            if ready > now {
                sleep(ready - now).await;
                continue;
            }
            self.starts.push_back(now);
            break;
        }
    }
}

pub struct CatalogState {
    #[cfg(test)]
    test_origin: Option<String>,
    client: Client,
    shikimori: Mutex<Queue>,
}
impl CatalogState {
    pub fn new() -> Self {
        Self {
            #[cfg(test)]
            test_origin: None,
            client: Client::builder()
                .user_agent("AnimDesk/1.0")
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(5))
                .build()
                .expect("HTTP client"),
            shikimori: Mutex::default(),
        }
    }
}

fn build_request(
    client: &Client,
    r: &CatalogRequest,
) -> Result<reqwest::RequestBuilder, CatalogError> {
    let page = r.page.unwrap_or(1);
    if !(1..=10000).contains(&page)
        || r.query.as_ref().is_some_and(|q| q.len() > 300)
        || r.year.is_some_and(|y| !(1900..=2200).contains(&y))
    {
        return Err(error("validation", "Invalid page/query/year"));
    }
    if r.kind
        .as_deref()
        .is_some_and(|k| !["tv", "movie", "ova", "ona", "special"].contains(&k))
    {
        return Err(error("validation", "Invalid kind"));
    }
    if r.operation == "detail"
        && !r.id.as_deref().is_some_and(|id| {
            id.parse::<u64>()
                .is_ok_and(|n| n > 0 && n.to_string() == id)
        })
    {
        return Err(error("validation", "Invalid id"));
    }
    if !["search", "detail", "top", "season", "genres"].contains(&r.operation.as_str()) {
        return Err(error("validation", "Invalid operation"));
    }
    if r.genre
        .as_deref()
        .is_some_and(|g| g.parse::<u32>().is_err() || g == "0")
    {
        return Err(error("validation", "Invalid genre"));
    }
    match r.provider.as_str() {
        "shikimori" => {
            if r.operation == "genres" {
                return Ok(client.post(SHIKIMORI_ENDPOINT).json(&json!({"query":"query AnimDeskGenres { genres(entryType: Anime) { id name russian } }", "variables":{}})));
            }
            let (args, declarations, vars) = match r.operation.as_str() {
                "detail" => ("ids:$ids,limit:1".to_owned(), "$ids:String".to_owned(), json!({"ids":r.id})),
                "top" => ("order:popularity,limit:20".into(), String::new(), json!({})),
                "season" => {
                    let season = r.season.as_deref().unwrap_or("");
                    let valid = season.split_once('_').is_some_and(|(s,y)| ["winter","spring","summer","fall"].contains(&s) && y.parse::<u32>().is_ok_and(|v| (1900..=2200).contains(&v)));
                    if !valid { return Err(error("validation", "Invalid season")); }
                    ("season:$season,limit:20,order:popularity".into(), "$season:SeasonString".into(), json!({"season":season}))
                },
                _ => ("search:$search,page:$page,limit:20,season:$season,kind:$kind,genre:$genre".into(), "$search:String,$page:PositiveInt,$season:SeasonString,$kind:AnimeKindString,$genre:String".into(), json!({"search":r.query,"page":page,"season":r.year.map(|y|y.to_string()),"kind":r.kind,"genre":r.genre})),
            };
            let fields = if r.operation == "detail" {
                DETAIL_FIELDS
            } else {
                LIST_FIELDS
            };
            let decl = if declarations.is_empty() {
                String::new()
            } else {
                format!("({declarations})")
            };
            Ok(client.post(SHIKIMORI_ENDPOINT).json(&json!({"query":format!("query AnimDesk{decl} {{ animes({args}) {{ {fields} }} }}"),"variables":vars})))
        }
        _ => Err(error("validation", "Unknown provider")),
    }
}

fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    value.parse().ok().or_else(|| {
        httpdate::parse_http_date(value)
            .ok()?
            .duration_since(std::time::SystemTime::now())
            .ok()
            .map(|d| d.as_secs() + 1)
    })
}

async fn execute(state: &CatalogState, request: CatalogRequest) -> Result<Value, CatalogError> {
    tokio::time::timeout(SOURCE_DEADLINE, execute_inner(state, request))
        .await
        .unwrap_or_else(|_| {
            Err(error(
                "timeout",
                "Catalog source deadline exceeded (queue, retries and HTTP): 12s",
            ))
        })
}

async fn execute_inner(
    state: &CatalogState,
    request: CatalogRequest,
) -> Result<Value, CatalogError> {
    // Validate before entering a queue. No URL, headers or GraphQL text are accepted from JS.
    let _ = build_request(&state.client, &request)?;
    let queue = &state.shikimori;
    {
        let q = queue.lock().await;
        let remaining = q
            .blocked_until
            .and_then(|until| until.checked_duration_since(Instant::now()));
        if q.blocked_permanently || remaining.is_some() {
            let mut e = error("rate_limit", "Provider Retry-After cooldown");
            e.retry_after_seconds = remaining.map(|duration| duration.as_secs() + 1);
            return Err(e);
        }
    }
    for attempt in 0..2 {
        queue.lock().await.acquire().await;
        let built = build_request(&state.client, &request)?
            .build()
            .map_err(|e| error("validation", e))?;
        #[cfg(test)]
        let built = {
            let mut built = built;
            if let Some(origin) = &state.test_origin {
                *built.url_mut() = origin.parse().unwrap();
            }
            built
        };
        let result = state.client.execute(built).await;
        let mut response = match result {
            Ok(response) => response,
            Err(e) => {
                if attempt == 0 {
                    continue;
                }
                return Err(error(if e.is_timeout() { "timeout" } else { "network" }, e));
            }
        };
        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let seconds = retry_after(response.headers()).unwrap_or(60);
            {
                let mut q = queue.lock().await;
                q.blocked_until = Instant::now().checked_add(Duration::from_secs(seconds));
                q.blocked_permanently = q.blocked_until.is_none();
            }
            if attempt == 0 && seconds <= 3 {
                continue;
            }
            let mut e = error("rate_limit", format!("HTTP 429; Retry-After={seconds}"));
            e.retry_after_seconds = Some(seconds);
            return Err(e);
        }
        if status.is_server_error() && attempt == 0 {
            continue;
        }
        if !status.is_success() {
            return Err(error("http", format!("HTTP {status}")));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| error(if e.is_timeout() { "timeout" } else { "network" }, e))?
        {
            if body.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err(error("invalid_response", "Response exceeds 4 MiB"));
            }
            body.extend_from_slice(&chunk);
        }
        let value: Value =
            serde_json::from_slice(&body).map_err(|e| error("invalid_response", e))?;
        if request.provider == "shikimori"
            && value
                .get("errors")
                .is_some_and(|v| !v.is_null() && v.as_array().is_none_or(|a| !a.is_empty()))
        {
            return Err(error("graphql", value["errors"].to_string()));
        }
        return Ok(value);
    }
    unreachable!()
}

#[tauri::command]
pub async fn catalog_request(
    state: tauri::State<'_, CatalogState>,
    request: CatalogRequest,
) -> Result<Value, CatalogError> {
    request_public_catalog(&state, request).await
}

async fn request_public_catalog(
    state: &CatalogState,
    request: CatalogRequest,
) -> Result<Value, CatalogError> {
    execute(state, request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mock_server(responses: Vec<String>) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut buffer = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let n = stream.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..n]);
                    if let Some(end) = buffer.windows(4).position(|v| v == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&buffer[..end]).to_lowercase();
                        let length = headers
                            .lines()
                            .find_map(|l| {
                                l.strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if buffer.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let _ = tx.send(String::from_utf8_lossy(&buffer).into_owned());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (address, rx)
    }
    fn response(status: &str, headers: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n{headers}\r\n{body}",body.len())
    }
    fn test_state(origin: String) -> CatalogState {
        let mut state = CatalogState::new();
        state.client = Client::builder()
            .user_agent("AnimDesk/1.0")
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        state.test_origin = Some(origin);
        state
    }
    fn search_request() -> CatalogRequest {
        serde_json::from_value(
            json!({"provider":"shikimori","operation":"search","query":"Death Note","page":2}),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn mock_http_graphql_error_200_and_user_agent() {
        let (origin, requests) = mock_server(vec![response(
            "200 OK",
            "",
            r#"{"data":null,"errors":[{"message":"bad field"}]}"#,
        )]);
        let e = execute(&test_state(origin), search_request())
            .await
            .unwrap_err();
        assert_eq!(e.code, "graphql");
        assert!(e.detail.contains("bad field"));
        let raw = requests.recv().unwrap();
        assert!(raw.to_lowercase().contains("user-agent: animdesk/1.0"));
        assert!(raw.contains("Death Note"));
        assert!(raw.contains("variables"));
    }
    #[tokio::test]
    async fn mock_http_429_respects_retry_after() {
        let (origin, _) = mock_server(vec![response(
            "429 Too Many Requests",
            "Retry-After: 30\r\n",
            "{}",
        )]);
        let state = test_state(origin);
        let e = execute(&state, search_request()).await.unwrap_err();
        assert_eq!(e.code, "rate_limit");
        assert_eq!(e.retry_after_seconds, Some(30));
        assert!(
            state.shikimori.lock().await.blocked_until.unwrap()
                > Instant::now() + Duration::from_secs(29)
        );
    }
    #[tokio::test]
    async fn mock_http_short_429_and_503_retried_once() {
        for first in [
            response("429 Too Many Requests", "Retry-After: 0\r\n", "{}"),
            response("503 Service Unavailable", "", "{}"),
        ] {
            let (origin, requests) = mock_server(vec![
                first,
                response("200 OK", "", r#"{"data":{"animes":[]}}"#),
            ]);
            assert_eq!(
                execute(&test_state(origin), search_request())
                    .await
                    .unwrap()["data"]["animes"],
                json!([])
            );
            assert_eq!(requests.try_iter().count(), 2);
        }
    }
    #[tokio::test]
    async fn mock_http_bad_json_and_status_are_explicit() {
        for (response, code) in [
            (
                response("200 OK", "", "<html>blocked</html>"),
                "invalid_response",
            ),
            (response("403 Forbidden", "", "{}"), "http"),
        ] {
            let (origin, _) = mock_server(vec![response]);
            assert_eq!(
                execute(&test_state(origin), search_request())
                    .await
                    .unwrap_err()
                    .code,
                code
            );
        }
    }
    #[tokio::test]
    async fn mock_network_failure_has_limited_retries() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let e = execute(&test_state(origin), search_request())
            .await
            .unwrap_err();
        assert!(["network", "timeout"].contains(&e.code));
    }
    #[tokio::test(start_paused = true)]
    async fn source_deadline_bounds_queue_wait_and_releases_lock() {
        let state = CatalogState::new();
        let now = Instant::now();
        state.shikimori.lock().await.starts = std::iter::repeat_n(now, 45).collect();
        let start = Instant::now();
        let e = execute(&state, search_request()).await.unwrap_err();
        assert_eq!(e.code, "timeout");
        assert_eq!(start.elapsed(), SOURCE_DEADLINE);
        assert!(state.shikimori.try_lock().is_ok());
        assert_eq!(state.shikimori.lock().await.starts.len(), 45);
    }
    #[tokio::test(start_paused = true)]
    async fn source_deadline_bounds_lock_contention() {
        let state = CatalogState::new();
        let _busy = state.shikimori.lock().await;
        let start = Instant::now();
        assert_eq!(
            execute(&state, search_request()).await.unwrap_err().code,
            "timeout"
        );
        assert_eq!(start.elapsed(), SOURCE_DEADLINE);
    }
    #[tokio::test]
    async fn discontinued_public_jikan_returns_explicit_error_without_http() {
        let state = CatalogState::new();
        let mut request = search_request();
        request.provider = "jikan".into();
        let e = request_public_catalog(&state, request).await.unwrap_err();
        assert_eq!(e.code, "validation");
        assert!(state.shikimori.lock().await.starts.is_empty());
    }
    #[test]
    fn restricted_requests_and_variables() {
        let state = CatalogState::new();
        let mut r: CatalogRequest = serde_json::from_value(
            json!({"provider":"shikimori","operation":"search","query":"Death Note","page":2}),
        )
        .unwrap();
        let req = build_request(&state.client, &r).unwrap().build().unwrap();
        assert_eq!(req.url().as_str(), "https://shikimori.io/api/graphql");
        assert_eq!(req.method(), reqwest::Method::POST);
        let body: Value = serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["variables"]["page"], 2);
        r.provider = "https://evil.example".into();
        assert!(build_request(&state.client, &r).is_err());
        r.provider = "jikan".into();
        r.operation = "detail".into();
        r.id = Some("../users".into());
        assert!(build_request(&state.client, &r).is_err());
    }
    #[test]
    fn retry_header_seconds_and_date() {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert("retry-after", "120".parse().unwrap());
        assert_eq!(retry_after(&h), Some(120));
        h.insert(
            "retry-after",
            httpdate::fmt_http_date(std::time::SystemTime::now() + Duration::from_secs(100))
                .parse()
                .unwrap(),
        );
        assert!(retry_after(&h).unwrap() >= 99);
    }
    #[tokio::test(start_paused = true)]
    async fn independent_rate_queues() {
        let mut q = Queue::default();
        let start = Instant::now();
        for _ in 0..46 {
            q.acquire().await;
        }
        assert!(start.elapsed() >= Duration::from_secs(60));
        let mut other = Queue::default();
        let now = Instant::now();
        other.acquire().await;
        assert_eq!(now.elapsed(), Duration::ZERO);
    }
}
