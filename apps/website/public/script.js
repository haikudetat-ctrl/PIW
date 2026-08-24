document.addEventListener('DOMContentLoaded',function(){
  var toggle=document.querySelector('.nav-toggle');var mainNav=document.querySelector('.main-nav');
  if(toggle&&mainNav){toggle.addEventListener('click',function(){var open=mainNav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open))});mainNav.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){mainNav.classList.remove('open');toggle.setAttribute('aria-expanded','false')})})}
  document.querySelectorAll('.faq-item').forEach(function(item){var button=item.querySelector('.faq-q');if(!button)return;button.addEventListener('click',function(){var open=item.classList.toggle('open');button.setAttribute('aria-expanded',String(open))})});
  var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;var reveals=document.querySelectorAll('.reveal');
  if(reduced||!('IntersectionObserver' in window)){reveals.forEach(function(el){el.classList.add('is-visible')})}else{var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}})},{threshold:.12});reveals.forEach(function(el){observer.observe(el)})}
  var form=document.getElementById('leadForm');var status=document.getElementById('successMsg');if(form){var submissionId=window.crypto.randomUUID();form.addEventListener('submit',async function(event){event.preventDefault();if(!form.checkValidity()){form.reportValidity();return}var submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;var data=new FormData(form);var params=new URLSearchParams(window.location.search);var locality=[data.get('state'),data.get('zip')].filter(Boolean).join(' ');var body={submission_id:submissionId,name:[data.get('first_name'),data.get('last_name')].filter(Boolean).join(' ').trim(),email:String(data.get('email')||'').trim(),phone:String(data.get('phone')||'').trim(),address:[data.get('address_line1'),data.get('city'),locality].filter(Boolean).join(', ').trim(),project_interest:data.get('project_interest'),consent_to_contact:data.get('consent_to_contact')==='on',consent_to_process_property:data.get('consent_to_process_property')==='on',fbclid:params.get('fbclid')};try{var response=await window.fetch('/api/intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});if(!response.ok)throw new Error(String(response.status));form.hidden=true;if(status)status.classList.add('show')}catch{var message=form.querySelector('[data-submit-error]');if(!message){message=document.createElement('p');message.dataset.submitError='true';message.setAttribute('role','alert');form.appendChild(message)}message.textContent='We could not send this request. Call (888) 832-5050 or try again.'}finally{if(submit)submit.disabled=false}})}
  var checklist=document.querySelector('[data-readiness-checklist]');if(checklist){var boxes=Array.from(checklist.querySelectorAll('input[type="checkbox"]'));var result=document.querySelector('[data-checklist-result]');function update(){var count=boxes.filter(function(box){return box.checked}).length;if(result){result.textContent=count===7?'You have reviewed all seven areas. Bring your notes to a contractor conversation.':count+' of 7 areas reviewed. Keep going at your own pace.'}try{localStorage.setItem('as-readiness',JSON.stringify(boxes.map(function(box){return box.checked})))}catch{}}
    try{var saved=JSON.parse(localStorage.getItem('as-readiness'));if(Array.isArray(saved)){boxes.forEach(function(box,index){box.checked=Boolean(saved[index])})}}catch{}boxes.forEach(function(box){box.addEventListener('change',update)});update();var reset=document.querySelector('[data-checklist-reset]');if(reset)reset.addEventListener('click',function(){boxes.forEach(function(box){box.checked=false});update()});var print=document.querySelector('[data-checklist-print]');if(print)print.addEventListener('click',function(){window.print()})}
  var reviewsSection=document.querySelector('[data-google-reviews]');
  if(reviewsSection){
    var reviewsTrack=reviewsSection.querySelector('[data-google-reviews-track]');
    var reviewsViewport=reviewsSection.querySelector('[data-google-reviews-viewport]');
    var reviewsFallback=reviewsSection.querySelector('[data-google-reviews-fallback]');
    var reviewsLink=reviewsSection.querySelector('[data-google-reviews-link]');
    var ratingLabel=reviewsSection.querySelector('[data-google-rating]');
    function safeReviewUrl(value,fallback){try{var url=new URL(value);return url.protocol==='https:'?url.href:fallback}catch{return fallback}}
    function makeReviewCard(review,fallbackUrl){
      var link=document.createElement('a');link.className='google-review-card';link.href=safeReviewUrl(review.reviewUri,fallbackUrl);link.target='_blank';link.rel='noopener';
      var avatar=document.createElement('span');avatar.className='review-avatar';
      if(review.photoUri){var photo=document.createElement('img');photo.src=safeReviewUrl(review.photoUri,'');photo.alt='';photo.loading='lazy';photo.referrerPolicy='no-referrer';avatar.appendChild(photo)}else{avatar.textContent=String(review.author||'G').slice(0,1).toUpperCase()}
      var body=document.createElement('span');body.className='review-body';
      var meta=document.createElement('span');meta.className='review-meta';
      var author=document.createElement('strong');author.textContent=review.author||'Google reviewer';
      var when=document.createElement('span');when.textContent=review.relativeTime||'';meta.append(author,when);
      var score=Math.max(0,Math.min(5,Number(review.rating)||0));var stars=document.createElement('span');stars.className='review-card-stars';stars.setAttribute('aria-label',score+' out of 5 stars');stars.textContent='★'.repeat(score)+'☆'.repeat(5-score);
      var quote=document.createElement('p');quote.textContent=review.text;body.append(meta,stars,quote);link.append(avatar,body);return link;
    }
    fetch('/api/google-reviews',{headers:{accept:'application/json'}}).then(function(response){if(!response.ok)throw new Error(String(response.status));return response.json()}).then(function(data){
      if(!reviewsTrack||!reviewsViewport||!Array.isArray(data.reviews)||!data.reviews.length)return;
      var googleUrl=safeReviewUrl(data.googleMapsUri,reviewsLink?reviewsLink.href:window.location.href);
      if(reviewsLink)reviewsLink.href=googleUrl;
      if(ratingLabel&&data.rating)ratingLabel.textContent=Number(data.rating).toFixed(1)+' from '+Number(data.reviewCount||0).toLocaleString()+' Google reviews';
      var cards=data.reviews.map(function(review){return makeReviewCard(review,googleUrl)});
      cards.concat(data.reviews.map(function(review){var duplicate=makeReviewCard(review,googleUrl);duplicate.setAttribute('aria-hidden','true');duplicate.tabIndex=-1;return duplicate})).forEach(function(card){reviewsTrack.appendChild(card)});
      reviewsViewport.hidden=false;if(reviewsFallback)reviewsFallback.hidden=true;
    }).catch(function(){if(reviewsFallback)reviewsFallback.hidden=false});
  }
  if(!document.querySelector('script[data-all-season-quote]')){var quoteScript=document.createElement('script');quoteScript.src='/quote-drawer.js';quoteScript.defer=true;quoteScript.dataset.allSeasonQuote='true';document.body.appendChild(quoteScript)}
});
