const handleGenerate = async () => {
  // ... (your existing loading/prompt check) ...

  try {
    const { data, error: fnError } = await supabase.functions.invoke("swift-service", {
      body: { prompt: prompt.trim() },
    });

    if (fnError) throw new Error(fnError.message);
    
    // THE FIX: This line removes the ```html and ``` backticks
    let rawHTML = data?.html_code || data?.content || "";
    const cleanHTML = rawHTML.replace(/```html|```/g, "").trim(); 

    setGeneratedCode(cleanHTML);
  } catch (err: any) {
    setError(err.message || "Failed to generate.");
  } finally {
    setLoading(false);
  }
};
