async function revalidateFrontends() {
  const secret = process.env.REVALIDATE_SECRET;

  const urls = [
    process.env.FRONTEND_A_REVALIDATE_URL,
    process.env.FRONTEND_B_REVALIDATE_URL,
  ].filter(Boolean);

  await Promise.allSettled(
    urls.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      })
    )
  );
}

module.exports = { revalidateFrontends };
