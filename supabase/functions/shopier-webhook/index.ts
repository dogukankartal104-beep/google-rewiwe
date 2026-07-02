// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const shopierSecret = Deno.env.get('SHOPIER_API_SECRET')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse the Shopier Webhook Payload
    const body = await req.json()
    const { status, order_id, custom_variable, signature } = body

    // 1. VERIFY SIGNATURE (Security Check)
    // Shopier usually signs a concatenated string of data.
    // Ensure you adapt this to the exact hash structure Shopier sends in your API version.
    const expectedData = `${status}${order_id}${custom_variable}`;
    
    // In Deno, generating an HMAC SHA256 is done via SubtleCrypto:
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(shopierSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify", "sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(expectedData)
    );
    // Convert to base64 to match Shopier's signature
    const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    if (base64Signature !== signature) {
      console.error("Invalid signature detected.");
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 2. PROCESS SUCCESSFUL PAYMENT
    if (status === 'success') {
      const businessId = custom_variable; // We assume you pass business_id when initiating payment

      // Fetch current subscription
      const { data: sub, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('business_id', businessId)
        .single();

      if (subError || !sub) {
        throw new Error('Subscription not found for this business.');
      }

      // Calculate new end date (+30 days)
      const currentEnd = new Date(sub.current_period_end);
      const now = new Date();
      // If already expired, start 30 days from NOW. If active, add 30 days to existing end.
      const baseDate = currentEnd > now ? currentEnd : now;
      const newEndDate = new Date(baseDate.getTime() + (30 * 24 * 60 * 60 * 1000));

      // Update Subscription
      await supabase
        .from('subscriptions')
        .update({ 
          current_period_end: newEndDate.toISOString(),
          status: 'active'
        })
        .eq('id', sub.id);

      // Log Payment
      await supabase
        .from('payment_logs')
        .insert([{
          business_id: businessId,
          subscription_id: sub.id,
          amount: body.total_amount || 150.00,
          currency: body.currency || 'TRY',
          shopier_order_id: order_id,
          status: 'success'
        }]);

      return new Response(JSON.stringify({ success: true, message: "Subscription extended by 30 days" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    return new Response(JSON.stringify({ success: true, message: "Ignored non-success status" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
