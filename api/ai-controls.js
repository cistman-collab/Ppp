// Expose only configuration presence; never serialize the API key into HTML.
export function renderAIControls(html, configured){
  if(!configured)return html;
  return html.replace(/<button\b[^>]*data-ai-control[^>]*>/g,tag=>tag.replace(/\sdisabled\b/g,'').replace(/\sstyle="opacity:0\.55;cursor:not-allowed;"/g,''))
    .replace('Ask AI — Unavailable','Ask AI')
    .replace('AI is currently not configured.','AI Review is available. Research only; no trades are executed.')
    .replace('AI assistant is disabled.','Choose a question above. Responses use the server-checked setup.')
    .replace('AI Review Unavailable','Review current setup')
    .replace('AI review is currently unavailable.','Request an AI review of the server-checked setup.');
}
