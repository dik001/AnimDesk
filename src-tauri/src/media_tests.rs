use super::*;
#[test]
fn unsafe_urls_and_paths() {
    for url in [
        "http://shikimori.io/a.png",
        "https://evil.test/a",
        "https://cdn.myanimelist.net.evil/a",
        "file:///C:/secret",
        "//evil/a",
        "https://user@shikimori.io/a",
        "https://127.0.0.1/a",
        "https://shikimori.io:444/a",
        "/%2e%2e/a",
        "C:\\secret",
    ] {
        assert!(normalize_url(url).is_err(), "{url}");
    }
    assert_eq!(
        normalize_url("/system/animes/original/1.jpg")
            .unwrap()
            .as_str(),
        "https://shikimori.io/system/animes/original/1.jpg"
    );
    assert_eq!(
        normalize_provider_url("images/anime/1.jpg", "jikan")
            .unwrap()
            .as_str(),
        "https://cdn.myanimelist.net/images/anime/1.jpg"
    );
    let tmp = tempfile::tempdir().unwrap();
    for path in [
        "../secret",
        "C:/secret",
        "avatars/../../secret.img",
        "avatars/a.img",
        "avatars/",
    ] {
        assert!(avatar_path(tmp.path(), path).is_err());
    }
}
#[test]
fn images_are_decoded_and_bounded() {
    assert!(image_mime(b"<svg></svg>").is_err());
    assert!(image_mime(b"\x89PNG\r\n\x1a\n").is_err());
    assert!(image_mime(&vec![0; IMAGE_LIMIT + 1]).is_err());
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    assert_eq!(image_mime(bytes.get_ref()).unwrap(), "image/png");
}
fn png() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn server(status: &str, headers: &str, body: Vec<u8>, delay_ms: u64) -> reqwest::Url {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/image", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {status}\r\n{headers}Connection: close\r\n\r\n");
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        let _ = socket.read(&mut request);
        std::thread::sleep(Duration::from_millis(delay_ms));
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.write_all(&body);
    });
    reqwest::Url::parse(&url).unwrap()
}
#[tokio::test]
async fn download_checks_mime_status_size_stream_and_timeout() {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(150))
        .build()
        .unwrap();
    let bytes = png();
    let url = server(
        "200 OK",
        &format!(
            "Content-Type: image/png\r\nContent-Length: {}\r\n",
            bytes.len()
        ),
        bytes.clone(),
        0,
    );
    assert_eq!(download_image(&client, url).await.unwrap(), bytes);
    for (status, headers, body, delay) in [
        ("200 OK", "Content-Type: text/html\r\n", bytes.clone(), 0),
        ("200 OK", "Content-Type: image/jpeg\r\n", bytes.clone(), 0),
        (
            "200 OK",
            "Content-Type: image/png\r\n",
            b"not an image".to_vec(),
            0,
        ),
        (
            "302 Found",
            "Content-Type: image/png\r\nLocation: http://127.0.0.1:1/private\r\n",
            bytes.clone(),
            0,
        ),
        (
            "200 OK",
            "Content-Type: image/png\r\nContent-Length: 99999999\r\n",
            vec![],
            0,
        ),
        (
            "200 OK",
            "Content-Type: image/png\r\n",
            vec![0; IMAGE_LIMIT + 1],
            0,
        ),
        ("200 OK", "Content-Type: image/png\r\n", bytes, 300),
    ] {
        assert!(
            download_image(&client, server(status, headers, body, delay))
                .await
                .is_err()
        );
    }
}
#[test]
fn cached_image_survives_reopen_and_does_not_read_injected_paths() {
    let root = tempfile::tempdir().unwrap();
    let bytes = png();
    let url = normalize_url("https://shikimori.io/a.png").unwrap();
    let key = format!("{}.img", hash(url.as_str().as_bytes()));
    let path = safe_dir(root.path(), &["cache", "covers"])
        .unwrap()
        .join(key);
    atomic_write(&path, &bytes).unwrap();
    assert_eq!(
        data_image(&read_bounded(&path, IMAGE_LIMIT).unwrap()).unwrap(),
        data_image(&bytes).unwrap()
    );
    let avatar = format!("avatars/{}.img", hash(&bytes));
    let path = avatar_path(root.path(), &avatar).unwrap();
    atomic_write(&path, &bytes).unwrap();
    assert!(data_image(&read_bounded(&path, IMAGE_LIMIT).unwrap()).is_ok());
    assert!(safe_dir(root.path(), &["..", "private"]).is_err());
    std::fs::write(root.path().join("large"), [0; 12]).unwrap();
    assert!(read_bounded(&root.path().join("large"), 10).is_err());
}
